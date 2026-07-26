import { signRequest } from '@worldcoin/idkit/signing'
import { hashSignal } from '@worldcoin/idkit/hashing'
import {
  WORLD_PRESETS,
  type Challenge,
  type HumanVerifier,
  type StepUpProof,
  type VerifyOutcome,
  type VerifierEnv,
  type VerifyPlan,
  type WorldPreset,
} from './types'

/**
 * World ID 4.0 (Managed) as a `HumanVerifier`.
 *
 * "Managed" means the Developer Portal owns RP registration and the on-chain side; we hold
 * one secret — the RP signing key — and do exactly two things with the protocol:
 *
 *   1. **Sign the proof request** (`challenge`). v4 closed the impersonation hole that v3
 *      had: World App will not produce a proof for an unsigned request, so the signature
 *      must be minted server-side. This is why `challenge()` is async and why the signing
 *      key is never a `NEXT_PUBLIC_*` var.
 *   2. **Verify the returned proof** (`verify`) by forwarding it byte-for-byte to the
 *      Portal. The browser can return any JSON it wants; only this call decides.
 *
 * Verified against the real SDK surface, 2026-07-25 (`@worldcoin/idkit` 4.2.1 /
 * `idkit-core` 4.2.2) — notes and the errors we actually hit are in `docs/feedback/world.md`.
 */

const VERIFY_HOST = 'https://developer.world.org'

/** Default step-up threshold in USD when `STEP_UP_USD` is unset. */
export const DEFAULT_STEP_UP_USD = 5

export type WorldConfig = {
  appId: `app_${string}`
  rpId: string
  signingKeyHex: string
  /** Scopes what the human is proving. Must exist in the Portal *in this environment*. */
  action: string
  environment: 'production' | 'staging' | 'sandbox'
  preset: WorldPreset
  stepUpUsd: number
  verifyHost: string
}

export class WorldConfigError extends Error {}

/**
 * Read config from env, or say precisely what is missing.
 *
 * World ID 4.0 needs three values from the Portal, not one: `app_id` is public,
 * `rp_id` identifies the relying party at verification time, and the signer key is the
 * secret. An app that only has `WORLD_APP_ID` has not completed 4.0 registration yet.
 */
export function worldConfigFromEnv(env: VerifierEnv = process.env): WorldConfig {
  // The Portal calls the secret half of the signer keypair the "signing key" in the docs
  // and hands it over as `WORLD_SIGNER_KEY` in the Managed flow. Both names are accepted
  // so nobody loses an hour to a rename.
  const signingKeyHex = env.WORLD_SIGNER_KEY ?? env.WORLD_RP_SIGNING_KEY
  const missing: string[] = []
  if (!env.WORLD_APP_ID) missing.push('WORLD_APP_ID')
  if (!env.WORLD_RP_ID) missing.push('WORLD_RP_ID')
  if (!signingKeyHex) missing.push('WORLD_SIGNER_KEY')
  if (missing.length > 0) {
    throw new WorldConfigError(
      `World verifier selected but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
        'Complete World ID 4.0 registration in the Developer Portal (see .env.example), or unset HUMAN_VERIFIER to run with the `none` verifier.',
    )
  }

  const appId = env.WORLD_APP_ID as string
  if (!appId.startsWith('app_')) {
    throw new WorldConfigError(`WORLD_APP_ID must start with "app_" (got "${appId.slice(0, 4)}…").`)
  }

  const environment = (env.WORLD_ENV ?? 'staging') as WorldConfig['environment']
  if (!['production', 'staging', 'sandbox'].includes(environment)) {
    throw new WorldConfigError(
      `WORLD_ENV must be production, staging or sandbox (got "${environment}").`,
    )
  }

  const preset = (env.WORLD_PRESET ?? 'proofOfHuman') as WorldPreset
  if (!WORLD_PRESETS.includes(preset)) {
    throw new WorldConfigError(
      `WORLD_PRESET must be one of ${WORLD_PRESETS.join(', ')} (got "${preset}").`,
    )
  }

  const stepUpUsd = Number(env.STEP_UP_USD ?? DEFAULT_STEP_UP_USD)
  if (!Number.isFinite(stepUpUsd) || stepUpUsd < 0) {
    throw new WorldConfigError(`STEP_UP_USD must be a non-negative number (got "${env.STEP_UP_USD}").`)
  }

  return {
    appId: appId as `app_${string}`,
    rpId: env.WORLD_RP_ID as string,
    signingKeyHex: signingKeyHex as string,
    action: env.WORLD_ACTION ?? 'planbound-approve-plan',
    environment,
    preset,
    stepUpUsd,
    verifyHost: env.WORLD_VERIFY_HOST ?? VERIFY_HOST,
  }
}

/**
 * The signal binds a proof to one plan.
 *
 * Without it, a proof collected for a $6 plan could be replayed against a $600 one. The
 * RP signature covers the *action*, which is the same for every plan, so the plan id has
 * to travel in the signal and be checked on the way back.
 */
export const planSignal = (planId: string): string => `planbound:${planId}`

/** The signal hash World returns when a preset carried no signal. Not a mismatch. */
const EMPTY_SIGNAL_HASHES = new Set(['0x0', '0x00', '0x'])

type ResponseItem = { nullifier?: string; signal_hash?: string }
type IdkitResultish = {
  environment?: string
  action?: string
  responses?: ResponseItem[]
}

export function makeWorldVerifier(config: WorldConfig): HumanVerifier {
  return {
    id: 'world',

    /**
     * Above the threshold, the ceiling is large enough that "whoever opened the link" is
     * not a good enough answer to "who approved this". Below it, the interruption costs
     * more than it protects — that is the whole argument of §2.
     */
    required(plan: VerifyPlan): boolean {
      return plan.ceilingUsd > config.stepUpUsd
    },

    async challenge(plan: VerifyPlan): Promise<Challenge> {
      // 300s default TTL. Short-lived by design: a leaked challenge is worthless in minutes.
      const { sig, nonce, createdAt, expiresAt } = signRequest({
        signingKeyHex: config.signingKeyHex,
        action: config.action,
      })

      return {
        kind: 'world',
        appId: config.appId,
        action: config.action,
        environment: config.environment,
        preset: config.preset,
        // `selfieCheckLegacy` only ever returns a 3.0 proof, so legacy proofs must be
        // accepted when it is the configured preset. `proofOfHuman` accepts them as an
        // Orb fallback for humans who have not migrated to a 4.0 credential.
        allowLegacyProofs: true,
        signal: planSignal(plan.planId),
        rpContext: {
          rp_id: config.rpId,
          nonce,
          created_at: createdAt,
          expires_at: expiresAt,
          signature: sig,
        },
      }
    },

    async verify({ plan, idkitResult }: StepUpProof): Promise<VerifyOutcome> {
      if (!idkitResult || typeof idkitResult !== 'object') {
        return { ok: false, code: 'malformed_proof', detail: 'No proof payload was submitted.' }
      }

      let res: Response
      try {
        res = await fetch(`${config.verifyHost}/api/v4/verify/${config.rpId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Forwarded as-is. Re-encoding a single field invalidates the proof.
          body: JSON.stringify(idkitResult),
          cache: 'no-store',
        })
      } catch (err) {
        // No offline mode exists for World verification — this is the fallback the spec's
        // trap list calls for, surfaced as a real error rather than a hung spinner.
        return {
          ok: false,
          code: 'verifier_unreachable',
          detail: `Could not reach World to verify: ${(err as Error).message}`,
        }
      }

      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean
        code?: string
        detail?: string
        nullifier?: string
      }

      if (!res.ok || body.success !== true) {
        // Log World's own reason. The proof itself is never logged — only why it was
        // refused — because "verification declined" with no code is undebuggable for an
        // operator and indistinguishable from our own bug.
        console.error(
          `[world] verify refused: http=${res.status} code=${body.code ?? 'none'} detail=${body.detail ?? 'none'}`,
        )
        return {
          ok: false,
          code: body.code ?? `http_${res.status}`,
          detail: body.detail ?? 'World rejected the proof.',
        }
      }

      // The Portal proves the proof is cryptographically valid. It does not know which
      // plan we asked about, so the two bindings below are ours to check.
      const result = idkitResult as IdkitResultish

      if (
        result.environment &&
        config.environment !== 'sandbox' &&
        result.environment !== config.environment
      ) {
        return {
          ok: false,
          code: 'environment_mismatch',
          detail: `Proof came from the ${result.environment} environment; this app expects ${config.environment}.`,
        }
      }

      if (result.action && result.action !== config.action) {
        return {
          ok: false,
          code: 'action_mismatch',
          detail: `Proof is for action "${result.action}", not "${config.action}".`,
        }
      }

      // Signal binding, checked where it exists. A credential that echoes a signal hash
      // must echo *ours*; one that returns `0x0` carried no signal at all, which is a
      // weaker claim — reported as `signalBound: false` rather than quietly treated as
      // equivalent. Either way the step-up ticket minted from this result is plan-scoped
      // server-side (`lib/verify/ticket.ts`), so a proof cannot move between plans.
      const expectedSignalHash = hashSignal(planSignal(plan.planId))
      const items = Array.isArray(result.responses) ? result.responses : []
      const echoed = items.filter((r) => r.signal_hash && !EMPTY_SIGNAL_HASHES.has(r.signal_hash))
      if (echoed.length > 0 && !echoed.some((r) => r.signal_hash === expectedSignalHash)) {
        return {
          ok: false,
          code: 'signal_mismatch',
          detail: 'The proof was bound to a different plan.',
        }
      }

      return {
        ok: true,
        nullifier: body.nullifier ?? items.find((r) => r.nullifier)?.nullifier,
        signalBound: echoed.length > 0,
      }
    },
  }
}
