import { NextResponse } from 'next/server'
import { decisionSchema } from '@planbound/core'
import { hcsLog, sweepEnvelope } from '@planbound/chains/hedera'
import { db } from '@/lib/db'
import { safeEqual } from '@/lib/ids'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Answer a drift block. Three exits, each of which does something different to the money:
 *
 *  drift_approved — raise this one step's ceiling to its live ask and resume. The plan's
 *                   overall ceiling still binds; a step that needs more than the envelope
 *                   holds will block again at the pay route, which is correct.
 *  drift_replan   — skip the step. It is no longer owed, so the plan costs less and the
 *                   agent may quote that category again.
 *  drift_abort    — stop, sweep the remainder back to the treasury, and keep the receipts
 *                   for what already settled. Sunk cost stays sunk; that is the honest part.
 *
 * Authorised by the approval key, like every other human decision, and never by the agent.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const key = new URL(req.url).searchParams.get('k') ?? ''
  const supabase = db()

  const { data: plan } = await supabase
    .from('plans')
    .select('id, status, approval_key, tolerance_pct')
    .eq('id', id)
    .maybeSingle()
  if (!plan || !safeEqual(key, plan.approval_key)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (plan.status !== 'blocked') {
    return NextResponse.json({ error: `plan is ${plan.status}, not blocked` }, { status: 409 })
  }

  const parsed = decisionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success || !parsed.data.outcome.startsWith('drift_')) {
    return NextResponse.json({ error: 'not a drift decision' }, { status: 400 })
  }
  const { outcome, stepIdx } = parsed.data
  if (stepIdx == null) {
    return NextResponse.json({ error: 'stepIdx is required' }, { status: 400 })
  }

  const { data: step } = await supabase
    .from('steps')
    .select('idx, live_ask_usd, quote_usd, service_name')
    .eq('plan_id', id)
    .eq('idx', stepIdx)
    .maybeSingle()
  if (!step) return NextResponse.json({ error: 'no such step' }, { status: 404 })

  await supabase.from('decisions').insert({
    plan_id: id,
    outcome,
    step_idx: stepIdx,
    reason: parsed.data.reason ?? null,
  })

  let status: string
  let sweptUsd: number | undefined

  if (outcome === 'drift_approved') {
    // Re-quote the step at what it actually asks. The gate then passes it on the retry
    // because the approved quote and the live ask finally agree — which is the honest
    // way to say "the human accepted this price", rather than disabling the gate.
    await supabase
      .from('steps')
      .update({ quote_usd: step.live_ask_usd ?? step.quote_usd, status: 'pending' })
      .eq('plan_id', id)
      .eq('idx', stepIdx)
    status = 'executing'
  } else if (outcome === 'drift_replan') {
    await supabase.from('steps').update({ status: 'skipped' }).eq('plan_id', id).eq('idx', stepIdx)
    status = 'executing'
  } else {
    // drift_abort
    const { data: envelope } = await supabase
      .from('envelopes')
      .select('hedera_account')
      .eq('plan_id', id)
      .maybeSingle()
    if (envelope?.hedera_account) {
      try {
        const swept = await sweepEnvelope(envelope.hedera_account)
        sweptUsd = swept.sweptUsd
        await supabase.from('envelopes').update({ swept_usd: swept.sweptUsd }).eq('plan_id', id)
      } catch (err) {
        // The human's decision stands even if the sweep needs a retry — recorded, not hidden.
        console.error(`[drift] sweep failed for ${id}:`, (err as Error).message)
      }
    }
    status = 'aborted'
  }

  await supabase.from('plans').update({ status }).eq('id', id)
  await hcsLog('drift', {
    planId: id,
    stepIdx,
    outcome,
    liveAskUsd: step.live_ask_usd == null ? null : Number(step.live_ask_usd),
    sweptUsd: sweptUsd ?? null,
  })

  return NextResponse.json({ ok: true, status, sweptUsd })
}
