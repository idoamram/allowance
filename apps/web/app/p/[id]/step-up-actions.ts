'use server'

import { db } from '@/lib/db'
import { humanVerifier } from '@/lib/verify'
import { mintStepUpTicket } from '@/lib/verify/ticket'
import type { Challenge, VerifyPlan } from '@/lib/verify'
import { verifyDecisionToken } from './token'

/**
 * The two halves of step-up, as server actions rather than API routes.
 *
 * Both secrets involved — the RP signer key and the plan's approval key — are things the
 * browser must never see, and a server action is the shortest path that keeps them here.
 * The client sends the same decision token the approve button uses, so a step-up call is
 * exactly as privileged as the decision it unlocks: no more, no less.
 */

export type ChallengeState = { challenge?: Challenge; error?: string }
export type StepUpState = { ticket?: string; error?: string; signalBound?: boolean }

/** Load the plan and prove the caller held the approval link, or say nothing useful. */
async function authorize(
  planId: string,
  token: string,
): Promise<{ plan: VerifyPlan; approvalKey: string } | { error: string }> {
  const supabase = db()
  const { data } = await supabase
    .from('plans')
    .select('id, goal, ceiling_usd, approval_key, status')
    .eq('id', planId)
    .maybeSingle()

  if (!data || !verifyDecisionToken(token, data.approval_key, planId)) {
    return { error: 'This page is no longer valid. Open the approval link again.' }
  }
  if (data.status !== 'pending_approval') {
    return { error: 'This plan has already been answered.' }
  }

  return {
    plan: { planId: data.id, goal: data.goal, ceilingUsd: Number(data.ceiling_usd) },
    approvalKey: data.approval_key,
  }
}

/**
 * Mint a fresh challenge at the moment the human asks for it.
 *
 * Deliberately not rendered with the page: an RP signature lives ~5 minutes, and an
 * approval page can sit open for an hour. A signature minted on page load would be dead by
 * the time anyone read the plan.
 */
export async function startStepUp(planId: string, token: string): Promise<ChallengeState> {
  const auth = await authorize(planId, token)
  if ('error' in auth) return { error: auth.error }

  const verifier = humanVerifier()
  if (!verifier.required(auth.plan)) {
    return { error: 'This plan does not require step-up verification.' }
  }

  try {
    return { challenge: await verifier.challenge(auth.plan) }
  } catch (err) {
    return { error: `Could not start verification: ${(err as Error).message}` }
  }
}

/**
 * Verify the proof and, only then, mint the ticket the approve button needs.
 *
 * The ticket is the *only* thing that crosses back to the browser. The proof itself is
 * never trusted client-side, and the nullifier never leaves this function.
 */
export async function completeStepUp(
  planId: string,
  token: string,
  idkitResult: unknown,
): Promise<StepUpState> {
  const auth = await authorize(planId, token)
  if ('error' in auth) return { error: auth.error }

  const verifier = humanVerifier()
  const outcome = await verifier.verify({ plan: auth.plan, idkitResult })
  if (!outcome.ok) return { error: outcome.detail }

  // The nullifier is signed into the ticket rather than returned beside it: the approve
  // path has to know *which* human proved this, and a value the client could substitute
  // would be worse than not checking at all.
  return {
    ticket: mintStepUpTicket(auth.approvalKey, planId, verifier.id, outcome.nullifier ?? ''),
    signalBound: outcome.signalBound,
  }
}
