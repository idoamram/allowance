import { NextResponse } from 'next/server'
import { planInputSchema, totalUsd } from '@planbound/core'
import { agentFromRequest } from '@/lib/auth'
import { db } from '@/lib/db'
import { newApprovalKey, newPlanId } from '@/lib/ids'

export const runtime = 'nodejs'

/**
 * The agent submits a priced plan and gets back the URL a human approves.
 * Nothing is funded here — submission is free, approval is what moves money.
 */
export async function POST(req: Request) {
  const agent = await agentFromRequest(req)
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = planInputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid plan', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      { status: 400 },
    )
  }
  const input = parsed.data

  const planId = newPlanId()
  const approvalKey = newApprovalKey()
  const supabase = db()

  const { error: planError } = await supabase.from('plans').insert({
    id: planId,
    agent_id: agent.id,
    goal: input.goal,
    approach: input.approach,
    total_usd: totalUsd(input.steps),
    ceiling_usd: input.ceilingUsd,
    tolerance_pct: input.tolerancePct,
    self_check: input.selfCheck,
    approval_key: approvalKey,
    expires_at: new Date(Date.now() + input.expiresInMin * 60_000).toISOString(),
  })
  if (planError) return NextResponse.json({ error: planError.message }, { status: 500 })

  const { error: stepsError } = await supabase.from('steps').insert(
    input.steps.map((s, idx) => ({
      plan_id: planId,
      idx,
      service_url: s.serviceUrl,
      service_name: s.serviceName,
      quote_usd: s.quoteUsd,
      source: s.source,
      buys: s.buys,
      why: s.why,
      rail: s.rail,
    })),
  )
  if (stepsError) return NextResponse.json({ error: stepsError.message }, { status: 500 })

  const base = process.env.APP_URL ?? new URL(req.url).origin
  return NextResponse.json({
    planId,
    approvalUrl: `${base}/p/${planId}?k=${approvalKey}`,
  })
}
