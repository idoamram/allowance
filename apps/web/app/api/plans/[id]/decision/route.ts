import { NextResponse } from 'next/server'
import { decisionSchema } from '@planbound/core'
import type { PlanStatus } from '@planbound/core'
import { db } from '@/lib/db'
import { safeEqual } from '@/lib/ids'

export const runtime = 'nodejs'

/** Which plan status each human answer produces. T7 hangs envelope minting off 'approved'. */
const STATUS_FOR: Record<string, PlanStatus> = {
  approved: 'approved',
  rejected: 'rejected',
  edited: 'pending_approval',
  drift_approved: 'executing',
  drift_replan: 'executing',
  drift_abort: 'aborted',
}

/**
 * The human's answer. Deliberately NOT agent-authenticated: it is authorised by the
 * approval key in the link, out of band from the agent's channel — an agent that can
 * talk to this API still cannot approve its own spending.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const key = new URL(req.url).searchParams.get('k') ?? ''
  const supabase = db()

  const { data: plan } = await supabase
    .from('plans')
    .select('id, status, approval_key, expires_at')
    .eq('id', id)
    .maybeSingle()

  if (!plan || !safeEqual(key, plan.approval_key)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const parsed = decisionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid decision', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      { status: 400 },
    )
  }
  const decision = parsed.data

  const isFirstAnswer = decision.outcome === 'approved' || decision.outcome === 'rejected'
  if (isFirstAnswer && plan.status !== 'pending_approval') {
    return NextResponse.json({ error: `plan is already ${plan.status}` }, { status: 409 })
  }
  if (decision.outcome === 'approved' && new Date(plan.expires_at) <= new Date()) {
    await supabase.from('plans').update({ status: 'expired' }).eq('id', id)
    return NextResponse.json({ error: 'plan expired' }, { status: 409 })
  }

  const { error: decisionError } = await supabase.from('decisions').insert({
    plan_id: id,
    outcome: decision.outcome,
    target: decision.target ?? null,
    reason: decision.reason ?? null,
    step_idx: decision.stepIdx ?? null,
  })
  if (decisionError) return NextResponse.json({ error: decisionError.message }, { status: 500 })

  const status = STATUS_FOR[decision.outcome]
  const { error: planError } = await supabase.from('plans').update({ status }).eq('id', id)
  if (planError) return NextResponse.json({ error: planError.message }, { status: 500 })

  return NextResponse.json({ ok: true, status })
}
