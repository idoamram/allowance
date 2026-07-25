'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { decisionSchema } from '@planbound/core'
import { db } from '@/lib/db'
import { humanVerifier } from '@/lib/verify'
import { verifyStepUpTicket } from '@/lib/verify/ticket'
import { verifyDecisionToken } from './token'

export type DecisionState = {
  ok?: boolean
  /** The plan status the API settled on — what the page shows after the answer. */
  status?: string
  error?: string
}

/** Where to reach our own API route. Behind a proxy the forwarded headers are the truth. */
async function selfOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

const field = (form: FormData, name: string): string | undefined => {
  const raw = form.get(name)
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value.length > 0 ? value : undefined
}

/**
 * Whether this approval may proceed, given the configured verifier. Returns the message to
 * show the human, or `undefined` when the gate is open.
 *
 * A misconfigured verifier blocks rather than waves through: policy said this ceiling needs
 * a human factor, and "we could not check" is not "it passed".
 */
function stepUpGate(
  planId: string,
  approvalKey: string,
  ceilingUsd: number,
  goal: string,
  form: FormData,
): string | undefined {
  let verifier
  try {
    verifier = humanVerifier()
  } catch (err) {
    return `Step-up verification is misconfigured, so nothing can be funded: ${(err as Error).message}`
  }

  if (!verifier.required({ planId, ceilingUsd, goal })) return undefined

  const ticket = String(form.get('stepUpTicket') ?? '')
  if (!verifyStepUpTicket(ticket, approvalKey, planId, verifier.id)) {
    return 'This ceiling needs a human factor. Verify above, then approve — the proof lasts ten minutes.'
  }
  return undefined
}

/**
 * The human's answer, submitted from the approval page.
 *
 * Two validations, deliberately: the form validates so the human is told what is missing,
 * and the API validates because it is the contract. A rejection without a typed target
 * fails both — it is the learning loop's only input, so an untyped "no" is not an answer.
 */
export async function submitDecision(
  planId: string,
  _prev: DecisionState,
  form: FormData,
): Promise<DecisionState> {
  const supabase = db()
  const { data: plan } = await supabase
    .from('plans')
    .select('approval_key, goal, ceiling_usd')
    .eq('id', planId)
    .maybeSingle()

  if (!plan || !verifyDecisionToken(String(form.get('token') ?? ''), plan.approval_key, planId)) {
    return { error: 'This page is no longer valid. Open the approval link again.' }
  }

  // Step-up, enforced here and not only in the UI. A disabled button is a courtesy to the
  // human; this is the check that matters, because a server action is addressable by
  // anyone who can read the client bundle. Only approval is gated — a rejection funds
  // nothing, so making the human prove themselves to say "no" is pure friction.
  if (form.get('outcome') === 'approved') {
    const gate = stepUpGate(planId, plan.approval_key, Number(plan.ceiling_usd), plan.goal, form)
    if (gate) return { error: gate }
  }

  const stepIdx = field(form, 'stepIdx')
  const parsed = decisionSchema.safeParse({
    outcome: form.get('outcome'),
    target: field(form, 'target'),
    reason: field(form, 'reason'),
    stepIdx: stepIdx === undefined ? undefined : Number(stepIdx),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'That answer is incomplete.' }
  }

  const res = await fetch(
    `${await selfOrigin()}/api/plans/${planId}/decision?k=${encodeURIComponent(plan.approval_key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    },
  )
  const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string }
  if (!res.ok) return { error: body.error ?? `The decision was not recorded (${res.status}).` }

  revalidatePath(`/p/${planId}`)
  return { ok: true, status: body.status }
}

/**
 * The answer to a drift block: approve the live ask, re-plan the step, or abort and take
 * the remainder back. Same authorisation as any other decision — the ticket proves the
 * caller opened the real link — but no step-up gate: the human is not raising their
 * exposure here, they are choosing among outcomes of a plan they already approved, and
 * two of the three options spend strictly less.
 */
export async function submitDriftDecision(
  _prev: DecisionState,
  form: FormData,
): Promise<DecisionState> {
  const planId = String(form.get('planId') ?? '')
  const supabase = db()
  const { data: plan } = await supabase
    .from('plans')
    .select('approval_key, status')
    .eq('id', planId)
    .maybeSingle()

  if (!plan || !verifyDecisionToken(String(form.get('token') ?? ''), plan.approval_key, planId)) {
    return { error: 'This page is no longer valid. Open the approval link again.' }
  }
  if (plan.status !== 'blocked') {
    return { error: `This plan is ${plan.status} — there is no drift to answer.` }
  }

  const stepIdx = field(form, 'stepIdx')
  const parsed = decisionSchema.safeParse({
    outcome: form.get('outcome'),
    stepIdx: stepIdx === undefined ? undefined : Number(stepIdx),
  })
  if (!parsed.success || !parsed.data.outcome.startsWith('drift_')) {
    return { error: 'That is not a drift answer.' }
  }

  const res = await fetch(
    `${await selfOrigin()}/api/plans/${planId}/drift-decision?k=${encodeURIComponent(plan.approval_key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    },
  )
  const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string }
  if (!res.ok) return { error: body.error ?? `The decision was not recorded (${res.status}).` }

  revalidatePath(`/p/${planId}`)
  return { ok: true, status: body.status }
}
