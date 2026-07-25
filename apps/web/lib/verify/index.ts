import type { HumanVerifier, VerifierEnv } from './types'
import { noneVerifier } from './none'
import { makeWorldVerifier, worldConfigFromEnv } from './world'

export type {
  Challenge,
  HumanVerifier,
  StepUpProof,
  VerifierEnv,
  VerifyOutcome,
  VerifyPlan,
  WorldPreset,
} from './types'
export { WORLD_PRESETS } from './types'
export { noneVerifier } from './none'
export { DEFAULT_STEP_UP_USD, WorldConfigError, planSignal } from './world'
export { mintStepUpTicket, verifyStepUpTicket } from './ticket'

/**
 * Which verifier this deployment runs, chosen by env and nothing else.
 *
 * Two rules, both deliberate:
 *
 * - **`none` is the default.** Not "none until World is configured" — `none` unless the
 *   operator opts in. A repo cloned with an empty `.env` gets a working approval flow, and
 *   nobody has to delete our provider wiring to run their own product.
 * - **Opting in fails loudly.** `HUMAN_VERIFIER=world` with an incomplete Portal
 *   registration throws with the names of the missing vars. The alternative — quietly
 *   degrading to `none` — turns "step-up is on" into a belief nobody checked.
 */
export function humanVerifier(env: VerifierEnv = process.env): HumanVerifier {
  const choice = env.HUMAN_VERIFIER ?? 'none'
  switch (choice) {
    case 'none':
      return noneVerifier
    case 'world':
      return makeWorldVerifier(worldConfigFromEnv(env))
    default:
      throw new Error(`HUMAN_VERIFIER must be "none" or "world" (got "${choice}").`)
  }
}

/**
 * The same selection, for surfaces that must not 500.
 *
 * A misconfigured verifier still has to fail closed — the approval page renders the
 * problem and refuses to fund anything — but it should say what is wrong instead of
 * showing a stack trace to whoever was about to approve a spend.
 */
export function humanVerifierOrError(
  env: VerifierEnv = process.env,
): { verifier: HumanVerifier; error?: undefined } | { verifier?: undefined; error: string } {
  try {
    return { verifier: humanVerifier(env) }
  } catch (err) {
    return { error: (err as Error).message }
  }
}
