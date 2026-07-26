'use client'

import { useState } from 'react'
import {
  IDKitRequestWidget,
  deviceLegacy,
  passport,
  proofOfHuman,
  selfieCheckLegacy,
  type Preset,
} from '@worldcoin/idkit'
import type { Challenge, WorldPreset } from '@/lib/verify/types'
import { completeStepUp, startStepUp } from './step-up-actions'
import styles from './approval.module.css'

/**
 * Preset name from env → the SDK factory. Adding one is a two-line change.
 *
 * `deviceLegacy` is the only one every World App holder can satisfy unaided: the others
 * each need a credential the human must first go and acquire — an Orb for `proofOfHuman`,
 * a passport scan for `passport`, an issued Face credential for `selfieCheckLegacy`. It is
 * the weakest of the four and is here so the step-up degrades to *some* real proof rather
 * than to nothing when the strong credential is unavailable.
 */
const PRESETS: Record<WorldPreset, (opts: { signal: string }) => Preset> = {
  proofOfHuman,
  selfieCheckLegacy,
  passport,
  deviceLegacy,
}

/**
 * The step-up block: a ceiling large enough that "whoever opened the link" stops being a
 * good enough answer to "who approved this".
 *
 * It sits above the approve button and gates it — the button is the funding act, so the
 * gate belongs in front of it and nowhere else. The server enforces the same thing again
 * on submit; this is the half the human can see.
 */
export function StepUp({
  planId,
  token,
  ceilingLabel,
  thresholdLabel,
  onVerified,
}: {
  planId: string
  token: string
  ceilingLabel: string
  thresholdLabel: string
  /** Handed the ticket the approve button carries. Never the proof. */
  onVerified: (ticket: string) => void
}) {
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function begin() {
    setBusy(true)
    setError(null)
    // The challenge is minted now, not at page load: an RP signature lives about five
    // minutes and this page can sit open for an hour.
    const state = await startStepUp(planId, token)
    setBusy(false)
    if (state.error || !state.challenge) {
      setError(state.error ?? 'Verification could not be started.')
      return
    }
    setChallenge(state.challenge)
    setOpen(true)
  }

  return (
    <div className={styles.stepUp}>
      <p className={styles.legend}>
        Confirm a human is here{' '}
        <span className={`${styles.stamp} ${styles.stampWarn}`}>required</span>
      </p>
      {/* Two different reasons, and saying the wrong one is worse than saying none. An
          empty threshold means the owner asked for every approval to be verified — there is
          no line this ceiling crossed to point at. */}
      <p className={styles.hint}>
        {thresholdLabel
          ? `${ceilingLabel} is above your ${thresholdLabel} step-up line.`
          : 'You asked for every approval to be verified.'}{' '}
        Approving funds the envelope, so this one asks for more than a link.
      </p>

      <button
        type="button"
        className={`${styles.btn} ${styles.ghost}`}
        onClick={begin}
        disabled={busy}
      >
        {busy ? 'Preparing…' : 'Verify with World ID'}
      </button>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {challenge?.kind === 'world' && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={challenge.appId}
          action={challenge.action}
          rp_context={challenge.rpContext}
          allow_legacy_proofs={challenge.allowLegacyProofs}
          environment={challenge.environment}
          preset={PRESETS[challenge.preset]({ signal: challenge.signal })}
          handleVerify={async (result) => {
            // The browser could return anything; the server decides. Throwing here puts
            // the widget in its own error state instead of falsely reporting success.
            const state = await completeStepUp(planId, token, result)
            if (state.error || !state.ticket) throw new Error(state.error ?? 'Verification failed.')
            onVerified(state.ticket)
          }}
          onSuccess={() => setOpen(false)}
          onError={(code) => setError(`World ID could not verify: ${code}`)}
        />
      )}
    </div>
  )
}
