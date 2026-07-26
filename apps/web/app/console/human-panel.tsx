'use client'

import { useState, useTransition } from 'react'
import {
  IDKitRequestWidget,
  deviceLegacy,
  passport,
  proofOfHuman,
  selfieCheckLegacy,
  type Preset,
} from '@worldcoin/idkit'
import type { Challenge, WorldPreset } from '@/lib/verify/types'
import type { HumanBinding, VerificationPolicy } from '@/lib/human-policy'
import {
  disconnectHuman,
  enrolHuman,
  saveVerificationPolicy,
  startEnrolment,
} from './human-actions'
import styles from './human.module.css'

const PRESETS: Record<WorldPreset, (opts: { signal: string }) => Preset> = {
  proofOfHuman,
  selfieCheckLegacy,
  passport,
  deviceLegacy,
}

const policies = (
  threshold: string,
): { value: VerificationPolicy; label: string; detail: string }[] => [
  { value: 'off', label: 'Never', detail: 'Anyone with the link can approve.' },
  {
    value: 'threshold',
    label: `Over ${threshold}`,
    detail: 'Smaller plans approve from the link alone.',
  },
  { value: 'always', label: 'Every plan', detail: 'However small.' },
]

/**
 * Who may approve — one card, not an essay.
 *
 * The claim stays narrow and so does the copy. World returns a value that is the same for
 * one person and different for everyone else, so we can recognise a returning human without
 * learning who they are. Calling that "identity verification" would be a lie, and this is
 * the screen where somebody decides how much to trust the mechanism.
 *
 * An earlier version explained all of that in three paragraphs above the control. Correct
 * and unreadable: a person coming back to change a setting had to scroll past an argument
 * they had already read. The reasoning now sits behind a disclosure, where it costs nothing
 * to leave closed.
 */
export function HumanPanel({
  binding,
  threshold,
}: {
  binding: HumanBinding
  threshold: string
}) {
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()

  async function begin() {
    setBusy(true)
    // A stale failure sitting under a fresh attempt reads as the new attempt failing.
    setError(null)
    const state = await startEnrolment()
    setBusy(false)
    if ('error' in state) return setError(state.error)
    setChallenge(state.challenge as Challenge)
    setOpen(true)
  }

  const connected = Boolean(binding.nullifier) || done

  return (
    <section className={styles.card} id="human">
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Identity</p>
          <h2 className={styles.title}>Who may approve</h2>
        </div>
        <span className={connected ? styles.pillOn : styles.pillOff}>
          <span className={connected ? styles.dotOn : styles.dotOff} aria-hidden="true" />
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </header>

      <p className={styles.lede}>
        {connected
          ? 'Approvals that need a human must come from you.'
          : 'Anyone holding an approval link can approve — including the agent that wrote the plan.'}
      </p>

      <fieldset className={styles.policy} disabled={pending}>
        <legend className={styles.legend}>Ask for my World ID</legend>
        <div className={styles.options}>
          {policies(threshold).map((p) => (
            <label key={p.value} className={styles.option}>
              <input
                type="radio"
                name="policy"
                value={p.value}
                defaultChecked={binding.policy === p.value}
                onChange={() => start(() => void saveVerificationPolicy(p.value))}
              />
              <span>
                <strong>{p.label}</strong>
                <span className={styles.optionDetail}>{p.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {!connected && binding.policy !== 'off' && (
        <p className={styles.warn} role="alert">
          Plans that need a World ID are being turned away. Connect one, or choose{' '}
          <strong>Never</strong>.
        </p>
      )}

      <div className={styles.actions}>
        {!connected ? (
          <button type="button" className={styles.btn} onClick={begin} disabled={busy}>
            {busy ? 'Preparing…' : 'Connect your World ID'}
          </button>
        ) : confirming ? (
          <>
            <button
              type="button"
              className={styles.btnDanger}
              onClick={() => start(() => void disconnectHuman())}
              disabled={pending}
            >
              {pending ? 'Disconnecting…' : 'Yes, disconnect'}
            </button>
            <button
              type="button"
              className={styles.btnQuiet}
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </button>
            {/* Says what disconnecting costs *given this account's policy*, rather than a
                generic warning. Under `Never` it changes nothing; under the others it
                starts refusing approvals, and that is worth knowing before the click. */}
            <p className={styles.confirmNote}>
              {binding.policy === 'off'
                ? 'Approvals go back to link-only.'
                : 'Approvals that need a World ID will be refused until you connect one.'}
            </p>
          </>
        ) : (
          <>
            <button type="button" className={styles.btnQuiet} onClick={begin} disabled={busy}>
              {busy ? 'Preparing…' : 'Replace'}
            </button>
            <button type="button" className={styles.btnQuiet} onClick={() => setConfirming(true)}>
              Disconnect
            </button>
            {binding.boundAt && (
              <span className={styles.since}>since {binding.boundAt.slice(0, 10)}</span>
            )}
          </>
        )}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <details className={styles.about}>
        <summary>How this works</summary>
        <p>
          An agent is handed the approval link the moment it submits a plan. A World ID proof
          is the one thing it cannot produce, so requiring one means a person approved &mdash;
          and matching it against yours means <em>you</em> did, not whoever else ends up with
          the link.
        </p>
        <p>
          We never learn who you are. World gives us one scrambled value: the same for you
          every time, different for everyone else.
        </p>
        <p>
          Connecting a different World ID replaces this one. That is the way back in if you
          lose the phone, and it means anyone who can sign in here could change it.
        </p>
      </details>

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
            setError(null)
            // The server decides. Throwing here puts the widget in its own error state
            // rather than reporting a success the account never recorded.
            const state = await enrolHuman(result)
            if (state.kind !== 'done') {
              throw new Error(state.kind === 'error' ? state.message : 'Could not connect.')
            }
            setDone(true)
          }}
          onSuccess={() => setOpen(false)}
          onError={(code) => setError(`World ID could not verify: ${code}`)}
        />
      )}
    </section>
  )
}
