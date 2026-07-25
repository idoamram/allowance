import { NextResponse } from 'next/server'
import { gate, payRequestSchema, remainingUsd } from '@planbound/core'
import type { PlanMoneyView, StepStatus } from '@planbound/core'
import { NETWORK_FOR_RAIL, probe, payAndFetch } from '@planbound/chains/x402pay'
import { createEnvelopeSigner, hcsLog, parseKey, treasury } from '@planbound/chains/hedera'
import { agentFromRequest } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * The only path money leaves an envelope by, and therefore the only place the gate has
 * to hold. The order matters: re-probe the seller for its LIVE price, gate against the
 * quote the human approved, and only then pay. Quoting at planning time and paying at
 * execution time is precisely the gap drift lives in.
 */
export async function POST(req: Request) {
  const agent = await agentFromRequest(req)
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = payRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid request', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      { status: 400 },
    )
  }
  const { planId, stepIdx, params } = parsed.data
  const supabase = db()

  const { data: plan } = await supabase
    .from('plans')
    .select('id, agent_id, status, ceiling_usd, tolerance_pct, expires_at')
    .eq('id', planId)
    .maybeSingle()
  if (!plan || plan.agent_id !== agent.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (!['approved', 'executing'].includes(plan.status)) {
    return NextResponse.json({ error: `plan is ${plan.status}, not payable` }, { status: 409 })
  }

  const [{ data: steps }, { data: envelope }] = await Promise.all([
    supabase.from('steps').select('*').eq('plan_id', planId).order('idx'),
    supabase.from('envelopes').select('*').eq('plan_id', planId).maybeSingle(),
  ])
  const step = steps?.find((s) => s.idx === stepIdx)
  if (!step) return NextResponse.json({ error: 'no such step' }, { status: 404 })
  if (step.status === 'paid') {
    return NextResponse.json({ error: 'step already paid', txRef: step.receipt?.txRef }, { status: 409 })
  }
  if (!envelope) {
    return NextResponse.json({ error: 'plan has no envelope — nothing funded it' }, { status: 409 })
  }

  const money: PlanMoneyView = {
    ceilingUsd: Number(plan.ceiling_usd),
    fundedUsd: Number(envelope.funded_usd),
    tolerancePct: Number(plan.tolerance_pct),
    steps: (steps ?? []).map((s) => ({
      quoteUsd: Number(s.quote_usd),
      status: s.status as StepStatus,
      paidUsd: s.paid_usd == null ? undefined : Number(s.paid_usd),
    })),
  }

  // What does the seller want RIGHT NOW, on this step's rail?
  const network = NETWORK_FOR_RAIL[step.rail] ?? undefined
  const live = await probe(step.service_url, { network })
  if (!live) {
    return NextResponse.json(
      { error: 'seller did not answer with a quote', serviceUrl: step.service_url },
      { status: 502 },
    )
  }

  const verdict = gate(
    { quoteUsd: Number(step.quote_usd) },
    live.amountUsd,
    remainingUsd(money),
    money.tolerancePct,
    new Date(),
    new Date(plan.expires_at),
  )

  if (!verdict.ok) {
    // Blocked. Record what was asked so the human's diff shows real numbers, put the
    // plan in front of them, and pay nothing.
    await supabase
      .from('steps')
      .update({ status: 'blocked', live_ask_usd: live.amountUsd })
      .eq('plan_id', planId)
      .eq('idx', stepIdx)
    await supabase.from('plans').update({ status: 'blocked' }).eq('id', planId)
    await hcsLog('drift', {
      planId,
      stepIdx,
      quoteUsd: Number(step.quote_usd),
      liveAskUsd: live.amountUsd,
      reason: verdict.reason,
    })

    const base = process.env.APP_URL ?? new URL(req.url).origin
    return NextResponse.json(
      { gate: verdict, diffUrl: `${base}/p/${planId}`, serviceName: step.service_name },
      { status: 409 },
    )
  }

  // Cleared. Pay from the plan's own funds — never from the treasury.
  try {
    const url = params
      ? `${step.service_url}${step.service_url.includes('?') ? '&' : '?'}${new URLSearchParams(
          Object.entries(params).map(([k, v]) => [k, String(v)]),
        )}`
      : step.service_url

    // On the Hedera rail the payer IS the envelope: the account bounded by the approved
    // ceiling pays the seller directly, agent + policy co-signing, with the facilitator's
    // fee-payer signature completing the threshold. Cap and payment, one account, one chain.
    let hederaSigner
    if (step.rail === 'hedera') {
      if (!envelope.hedera_account) {
        return NextResponse.json({ error: 'plan has no Hedera envelope to pay from' }, { status: 409 })
      }
      const { policyKey } = await treasury()
      // Verify the agent key against the public key the envelope was actually built from.
      // Raw-hex keys are algorithm-ambiguous, and the only symptom of getting it wrong is
      // INVALID_SIGNATURE at settlement — far from the cause (spike S1, and again tonight).
      const { data: agentRow } = await supabase
        .from('agents')
        .select('hedera_public_key')
        .eq('id', plan.agent_id)
        .maybeSingle()
      hederaSigner = createEnvelopeSigner({
        envelopeAccountId: envelope.hedera_account,
        agentKey: parseKey(
          process.env.AGENT_HEDERA_KEY ?? process.env.AGENT_EVM_KEY ?? '',
          agentRow?.hedera_public_key ?? undefined,
        ),
        policyKey,
      })
    }

    const paid = await payAndFetch(
      url,
      {
        evmKey: process.env.PLAN_WALLET_KEY as `0x${string}` | undefined,
        hedera: hederaSigner,
      },
      { maxUsd: verdict.maxAllowedUsd, network },
    )

    const receipt = {
      ask: live.amountUsd,
      paid: paid.paidUsd,
      txRef: paid.txRef,
      network: paid.network,
      payTo: paid.payTo,
      at: new Date().toISOString(),
    }
    await supabase
      .from('steps')
      .update({ status: 'paid', paid_usd: paid.paidUsd, live_ask_usd: live.amountUsd, receipt })
      .eq('plan_id', planId)
      .eq('idx', stepIdx)
    if (plan.status !== 'executing') {
      await supabase.from('plans').update({ status: 'executing' }).eq('id', planId)
    }
    await hcsLog('receipt', { planId, stepIdx, ...receipt })

    return NextResponse.json({ data: paid.data, paidUsd: paid.paidUsd, txRef: paid.txRef })
  } catch (err) {
    // A payment that failed is not a payment that happened: leave the step pending so it
    // can be retried, and say what broke rather than inventing a receipt.
    const reason = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'payment failed', reason }, { status: 502 })
  }
}
