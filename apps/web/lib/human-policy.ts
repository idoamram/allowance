/**
 * Who may approve, decided as pure functions.
 *
 * Separate from `human-binding.ts` because that file talks to the database and is
 * `server-only`, which makes it unimportable from a test. The rules below are the security
 * claim this feature makes, so they are the part that most needs testing — the same reason
 * `packages/core/money.ts` holds the gate arithmetic away from the route that spends.
 */

export type VerificationPolicy = 'off' | 'threshold' | 'always'

export interface HumanBinding {
  /** The World nullifier this account enrolled. Null until someone does. */
  nullifier: string | null
  /** Which preset produced it — evidence of what was actually proved, not a key. */
  preset: string | null
  policy: VerificationPolicy
  boundAt: string | null
}

export type BindingCheck =
  | { ok: true }
  | { ok: false; code: 'not_enrolled' | 'different_human'; detail: string }

/**
 * Does this proof come from the human this account is bound to?
 *
 * Called only after World has vouched for the proof itself — this decides *whose* proof it
 * was, never whether it was real.
 *
 * `not_enrolled` refuses. A policy that demands a bound human while none is enrolled is a
 * misconfiguration, and reading a misconfiguration as permission is how a security control
 * becomes decoration — worse than absent, because it reads as protection precisely when it
 * is providing none.
 */
export function checkBinding(
  binding: HumanBinding,
  nullifier: string | undefined,
): BindingCheck {
  if (!binding.nullifier) {
    return {
      ok: false,
      code: 'not_enrolled',
      detail:
        'this account requires a bound World ID and none is enrolled — enrol from the console before approving',
    }
  }
  if (!nullifier) {
    return {
      ok: false,
      code: 'different_human',
      detail: 'the proof carried no nullifier, so it cannot be matched to this account',
    }
  }
  if (nullifier !== binding.nullifier) {
    return {
      ok: false,
      code: 'different_human',
      detail:
        'that is a valid proof from a different World ID than this account is bound to — approval refused',
    }
  }
  return { ok: true }
}

/** Whether a plan of this size needs the bound human present. */
export function verificationRequired(
  policy: VerificationPolicy,
  ceilingUsd: number,
  stepUpUsd: number,
): boolean {
  if (policy === 'off') return false
  if (policy === 'always') return true
  return ceilingUsd > stepUpUsd
}
