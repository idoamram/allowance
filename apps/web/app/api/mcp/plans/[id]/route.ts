import { NextResponse } from 'next/server'
import { agentFromRequest } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/** The agent polls this while it waits for a human — status, the decision, the envelope. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const agent = await agentFromRequest(req)
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const supabase = db()

  const { data: plan } = await supabase
    .from('plans')
    .select('id, agent_id, goal, approach, status, total_usd, ceiling_usd, tolerance_pct, expires_at')
    .eq('id', id)
    .maybeSingle()

  // Same answer for "no such plan" and "not your plan" — plan ids aren't a directory.
  if (!plan || plan.agent_id !== agent.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const [{ data: steps }, { data: decisions }, { data: envelope }] = await Promise.all([
    supabase.from('steps').select('*').eq('plan_id', id).order('idx'),
    supabase.from('decisions').select('*').eq('plan_id', id).order('created_at'),
    supabase.from('envelopes').select('*').eq('plan_id', id).maybeSingle(),
  ])

  return NextResponse.json({
    planId: plan.id,
    status: plan.status,
    goal: plan.goal,
    approach: plan.approach,
    totalUsd: Number(plan.total_usd),
    ceilingUsd: Number(plan.ceiling_usd),
    tolerancePct: Number(plan.tolerance_pct),
    expiresAt: plan.expires_at,
    steps: (steps ?? []).map((s) => ({
      idx: s.idx,
      serviceName: s.service_name,
      serviceUrl: s.service_url,
      quoteUsd: Number(s.quote_usd),
      source: s.source,
      buys: s.buys,
      why: s.why,
      rail: s.rail,
      status: s.status,
      paidUsd: s.paid_usd == null ? null : Number(s.paid_usd),
      liveAskUsd: s.live_ask_usd == null ? null : Number(s.live_ask_usd),
      receipt: s.receipt,
    })),
    decision: decisions?.at(-1) ?? null,
    decisions: decisions ?? [],
    envelope: envelope ?? null,
  })
}
