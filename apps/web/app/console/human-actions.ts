'use server'

import { revalidatePath } from 'next/cache'
import { bindHuman, setPolicy, unbindHuman, type VerificationPolicy } from '@/lib/human-binding'
import { humanVerifier } from '@/lib/verify'
import { worldPreset } from '@/lib/verify/world'
import { requireUser } from '@/lib/supabase/server'

/**
 * Enrolment: record which human this account belongs to.
 *
 * `requireUser()` first, and that ordering is the security property rather than a
 * convenience. The nullifier is only meaningful as an answer to "who owns this account",
 * so it has to be captured from someone who has already proved they do. Binding from an
 * unauthenticated page — or on first approval — would let whoever got there first claim
 * the account.
 *
 * The proof is verified by World here, exactly as it is on the approval page. This action
 * never trusts a nullifier the browser hands it; it trusts the one World returns.
 */
export type EnrolState =
  | { kind: 'idle' }
  | { kind: 'done'; preset: string }
  | { kind: 'error'; message: string }

export async function enrolHuman(idkitResult: unknown): Promise<EnrolState> {
  const user = await requireUser()

  let verifier
  try {
    verifier = humanVerifier()
  } catch (err) {
    return { kind: 'error', message: `Verification is misconfigured: ${(err as Error).message}` }
  }

  // Enrolment is not about a plan, but the verifier's contract is plan-shaped. A stable
  // per-account signal keeps the proof bound to something rather than to nothing.
  const outcome = await verifier.verify({
    plan: {
      planId: `enrol:${user.id}`,
      ceilingUsd: 0,
      goal: 'Bind this account to a World ID',
    },
    idkitResult,
  })

  if (!outcome.ok) return { kind: 'error', message: outcome.detail }
  if (!outcome.nullifier) {
    // Without a nullifier there is nothing to compare later, so enrolling would produce a
    // binding that can never match. Refusing is more honest than storing an empty one.
    return {
      kind: 'error',
      message:
        'That proof carried no nullifier, so it cannot identify this account on a later approval. Try a different verification method.',
    }
  }

  // The preset, not the verifier id. `verifier.id` is 'world' for every World preset, which
  // records nothing — the fact worth keeping is *what was proved*, since deviceLegacy and
  // selfieCheckLegacy are very different claims about the same person.
  await bindHuman(user.id, outcome.nullifier, worldPreset() ?? verifier.id)
  revalidatePath('/console')
  return { kind: 'done', preset: verifier.id }
}

export async function saveVerificationPolicy(policy: VerificationPolicy): Promise<void> {
  const user = await requireUser()
  await setPolicy(user.id, policy)
  revalidatePath('/console')
}

/**
 * The signed World challenge for enrolment.
 *
 * Built server-side like the approval page's, because minting it needs the RP signing key.
 * The pseudo-plan carries the account id so the proof is bound to *this* account rather
 * than floating free.
 */
export type EnrolChallenge = { challenge: unknown } | { error: string }

export async function startEnrolment(): Promise<EnrolChallenge> {
  const user = await requireUser()
  try {
    const verifier = humanVerifier()
    return {
      challenge: await verifier.challenge({
        planId: `enrol:${user.id}`,
        ceilingUsd: 0,
        goal: 'Bind this account to a World ID',
      }),
    }
  } catch (err) {
    return { error: `Could not start verification: ${(err as Error).message}` }
  }
}

export async function disconnectHuman(): Promise<void> {
  const user = await requireUser()
  await unbindHuman(user.id)
  revalidatePath('/console')
}
