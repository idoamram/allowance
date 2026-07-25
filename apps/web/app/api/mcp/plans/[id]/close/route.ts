import { NextResponse } from 'next/server'
import { hcsLog, sweepEnvelope } from '@planbound/chains/hedera'
import { agentFromRequest } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * The agent says it's finished. Whatever the envelope still holds goes home, and the plan
 * becomes a record: quoted, paid, swept.
 *
 * This is a convenience, not the guarantee — the guarantee is the scheduled refund minted
 * with the envelope, which fires at expiry whether or not anyone calls this. Closing early
 * just means the money comes back in seconds instead of hours.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const agent = await agentFromRequest(req)
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const supabase = db()

  const { data: plan } = await supabase
    .from('plans')
    .select('id, agent_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!plan || plan.agent_id !== agent.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (['settled', 'aborted', 'rejected'].includes(plan.status)) {
    return NextResponse.json({ error: `plan is already ${plan.status}` }, { status: 409 })
  }

  const { data: envelope } = await supabase
    .from('envelopes')
    .select('plan_id, hedera_account, funded_usd, swept_usd')
    .eq('plan_id', id)
    .maybeSingle()

  let sweptUsd = 0
  if (envelope?.hedera_account && envelope.swept_usd == null) {
    try {
      const swept = await sweepEnvelope(envelope.hedera_account)
      sweptUsd = swept.sweptUsd
      await supabase.from('envelopes').update({ swept_usd: sweptUsd }).eq('plan_id', id)
    } catch (err) {
      // Say so rather than reporting a sweep that didn't happen. The scheduled refund is
      // still standing, so the money is not stranded — it just returns later.
      const reason = err instanceof Error ? err.message : String(err)
      return NextResponse.json(
        { error: 'sweep failed', reason, note: 'the scheduled refund at expiry still stands' },
        { status: 502 },
      )
    }
  }

  await supabase.from('plans').update({ status: 'settled' }).eq('id', id)
  await hcsLog('sweep', { planId: id, sweptUsd, envelope: envelope?.hedera_account ?? null })

  const { data: steps } = await supabase
    .from('steps')
    .select('quote_usd, paid_usd, status')
    .eq('plan_id', id)
  const quotedUsd = (steps ?? []).reduce((s, x) => s + Number(x.quote_usd), 0)
  const paidUsd = (steps ?? []).reduce((s, x) => s + Number(x.paid_usd ?? 0), 0)

  return NextResponse.json({
    status: 'settled',
    quotedUsd: Number(quotedUsd.toFixed(6)),
    paidUsd: Number(paidUsd.toFixed(6)),
    sweptUsd,
  })
}
