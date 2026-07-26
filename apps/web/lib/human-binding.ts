import 'server-only'
import { db } from './db'

/**
 * Which human an account belongs to, and when their presence is required.
 *
 * The World nullifier is stable per (app, action, World ID) and pseudonymous: the same person
 * always produces the same value, a different person never does, and it reveals nothing about
 * who they are. Recorded once at enrolment, it upgrades an approval from "somebody alive was
 * here" to "the person who enrolled was here" — which is an authorization claim rather than a
 * liveness one.
 *
 * Enrolment happens from an authenticated session and nowhere else. Binding on first
 * *approval* would have been simpler and is the wrong order: whoever approved first would
 * become the account's human, so a leaked link would let a stranger bind themselves and lock
 * the owner out. Requiring an existing session means the thing being bound was established by
 * someone who was already inside.
 */

export type { VerificationPolicy, HumanBinding, BindingCheck } from './human-policy'
export { checkBinding, verificationRequired } from './human-policy'

import type { HumanBinding as Binding } from './human-policy'

const DEFAULT: Binding = {
  nullifier: null,
  preset: null,
  policy: 'threshold',
  boundAt: null,
}

interface Row {
  nullifier: string | null
  preset: string | null
  policy: Binding['policy']
  bound_at: string | null
}

export async function getBinding(userId: string): Promise<Binding> {
  const { data } = await db()
    .from('human_bindings')
    .select('nullifier, preset, policy, bound_at')
    .eq('user_id', userId)
    .maybeSingle()

  const row = data as Row | null
  // No row means nobody has touched the setting. That is the default, not an error.
  if (!row) return DEFAULT
  return {
    nullifier: row.nullifier,
    preset: row.preset,
    policy: row.policy,
    boundAt: row.bound_at,
  }
}

/**
 * Record the human this account belongs to.
 *
 * Re-enrolling overwrites, deliberately: losing access to a World ID must not lock someone
 * out of their own money forever. That is a real weakening — whoever holds the account
 * session can re-point the binding, so the guarantee is "the enrolled human, or whoever can
 * sign in". Stated rather than hidden, because the alternative is an account that becomes
 * permanently unusable when a phone is lost.
 */
export async function bindHuman(
  userId: string,
  nullifier: string,
  preset: string,
): Promise<void> {
  const { error } = await db().from('human_bindings').upsert(
    { user_id: userId, nullifier, preset, bound_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  if (error) throw new Error(`could not record the binding: ${error.message}`)
}

export async function setPolicy(userId: string, policy: Binding['policy']): Promise<void> {
  const { error } = await db()
    .from('human_bindings')
    .upsert({ user_id: userId, policy }, { onConflict: 'user_id' })
  if (error) throw new Error(`could not save the setting: ${error.message}`)
}
