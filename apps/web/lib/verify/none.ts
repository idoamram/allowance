import type { Challenge, HumanVerifier, VerifyOutcome } from './types'

/**
 * The default verifier: step-up is never required.
 *
 * This is not a stub waiting to be replaced. It is the shipping configuration for anyone
 * who clones this repo without a World Developer Portal app — the approval link plus its
 * unguessable key is the whole factor, exactly as in `p/[id]/token.ts`. Every other
 * verifier is an *addition* to this path, never a precondition for it.
 *
 * `verify()` refusing is deliberate: if code ever asks the `none` verifier to validate a
 * proof, something upstream believed step-up was required. Answering "ok" there would
 * convert a configuration mistake into a silent bypass.
 */
export const noneVerifier: HumanVerifier = {
  id: 'none',

  required(): boolean {
    return false
  },

  async challenge(): Promise<Challenge> {
    return { kind: 'none' }
  },

  async verify(): Promise<VerifyOutcome> {
    return {
      ok: false,
      code: 'step_up_not_configured',
      detail: 'No human verifier is configured, so no proof can be accepted.',
    }
  },
}
