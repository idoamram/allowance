'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { decisionSchema } from '@planbound/core'
import { db } from '@/lib/db'
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
    .select('approval_key')
    .eq('id', planId)
    .maybeSingle()

  if (!plan || !verifyDecisionToken(String(form.get('token') ?? ''), plan.approval_key, planId)) {
    return { error: 'This page is no longer valid. Open the approval link again.' }
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
