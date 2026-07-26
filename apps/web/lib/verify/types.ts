/**
 * `HumanVerifier` — the step-up contract from the spec's "Pluggable approval and identity"
 * (`plans/product-spec/latest.md` §5).
 *
 * The point of the seam: *what step-up requires* is policy, and policy must be swappable
 * without touching the approval flow. `none` is the default and always will be — the whole
 * product has to work with no World app at all, because a cloner of this public repo does
 * not have ours. World is a registration, not a rewrite.
 *
 * Nothing in this file imports a provider SDK. `none.ts` and `world.ts` do.
 */

/**
 * Configuration source. Structurally `process.env`, but loose enough that a test can pass
 * five keys instead of faking the whole environment.
 */
export type VerifierEnv = Record<string, string | undefined>

/** The only part of a plan a verifier is allowed to reason about. */
export type VerifyPlan = {
  planId: string
  /** The approved ceiling — the number the threshold is compared against. */
  ceilingUsd: number
  /** Shown to the human inside the World App sheet so they know what they are confirming. */
  goal: string
}

/** RP context for a World ID 4.0 proof request. Structural, so this file stays SDK-free. */
export type RpContextJson = {
  rp_id: string
  nonce: string
  created_at: number
  expires_at: number
  signature: string
}

/**
 * What the page needs to render the challenge. `none` renders nothing — the approve
 * button is simply live, which is the dev-mode product.
 */
export type Challenge =
  | { kind: 'none' }
  | {
      kind: 'world'
      appId: `app_${string}`
      action: string
      environment: 'production' | 'staging' | 'sandbox'
      /** Which credential the human is asked for. See `world.ts` for why it is configurable. */
      preset: WorldPreset
      allowLegacyProofs: boolean
      /** Bound into the proof: this plan and nothing else. */
      signal: string
      rpContext: RpContextJson
    }

/** The presets we accept from env. Names match `@worldcoin/idkit`'s exported factories. */
export const WORLD_PRESETS = [
  'proofOfHuman',
  'selfieCheckLegacy',
  'passport',
  'deviceLegacy',
] as const
export type WorldPreset = (typeof WORLD_PRESETS)[number]

/** What comes back from the client after the human finishes in World App. */
export type StepUpProof = {
  plan: VerifyPlan
  /** The IDKit result, forwarded byte-for-byte. Opaque here on purpose. */
  idkitResult: unknown
}

export type VerifyOutcome =
  | {
      ok: true
      /** RP+action-scoped, non-reversible. Never a user identifier. */
      nullifier?: string
      /**
       * Whether the credential actually carried our plan-scoped signal back.
       * Recorded rather than assumed: some presets return `signal_hash: "0x0"`, and a
       * proof that isn't bound to the plan is a weaker claim than one that is.
       */
      signalBound: boolean
    }
  | { ok: false; code: string; detail: string }

export interface HumanVerifier {
  readonly id: 'none' | 'world'
  /** Does *this* plan need a human factor beyond holding the approval link? */
  required(plan: VerifyPlan): boolean
  /** What to put in front of the human. Only called when `required()` is true. */
  challenge(plan: VerifyPlan): Promise<Challenge>
  /** The server's verdict. A client can return any JSON it likes; only this decides. */
  verify(proof: StepUpProof): Promise<VerifyOutcome>
}
