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
import { enrolHuman, saveVerificationPolicy, startEnrolment } from './human-actions'
import styles from './human.module.css'

const PRESETS: Record<WorldPreset, (opts: { signal: string }) => Preset> = {
  proofOfHuman,
  selfieCheckLegacy,
  passport,
  deviceLegacy,
}

const POLICIES: { value: VerificationPolicy; label: string; detail: string }[] = [
  {
    value: 'off',
    label: 'Never',
    detail: 'The approval link alone approves. Right when an interruption costs more than it protects.',
  },
  {
    value: 'threshold',
    label: 'Above the step-up line',
    detail: 'Only plans large enough that "whoever opened the link" stops being a good enough answer.',
  },
  {
    value: 'always',
    label: 'Every approval',
    detail: 'Every plan, whatever the ceiling.',
  },
]

/**
 * Enrol the human this account belongs to, and choose when their presence is required.
 *
 * The claim this panel makes is narrow and the copy has to stay inside it. World returns a
 * pseudonymous nullifier — the same person always produces the same one — so we can tell
 * *the same human* from *a different human* without ever learning who either is. That is
 * continuity, not identity. Saying "verify your identity" here would be a lie, and this is
 * exactly the screen where a person decides how much to trust the thing.
 */
export function HumanPanel({ binding }: { binding: HumanBinding }) {
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, start] = useTransition()

  async function begin() {
    setBusy(true)
    setError(null)
    const state = await startEnrolment()
    setBusy(false)
    if ('error' in state) return setError(state.error)
    setChallenge(state.challenge as Challenge)
    setOpen(true)
  }

  const enrolled = Boolean(binding.nullifier) || done

  return (
    <section className={styles.panel} id="human">
      <div className={styles.head}>
        <h2 className={styles.title}>Who may approve</h2>
        <span className={enrolled ? styles.stampOn : styles.stampOff}>
          {enrolled ? 'bound' : 'not bound'}
        </span>
      </div>

      <p className={styles.sub}>
        An agent holds the approval link for its own plan &mdash; it is handed one the moment
        it submits. A World ID proof is the thing an agent cannot produce. Binding one to this
        account goes further: it tells a later approval apart from{' '}
        <em>the same person who enrolled</em> and <em>anyone else holding the link</em>.
      </p>

      <p className={styles.note}>
        This is continuity, not identity. World returns a pseudonymous value that is stable
        for one person and one app &mdash; we can tell you apart from someone else, and we
        never learn who you are.
      </p>

      {enrolled ? (
        <p className={styles.bound}>
          Bound to a World ID
          {binding.preset && <> via <code>{binding.preset}</code></>}
          {binding.boundAt && <> on {binding.boundAt.slice(0, 10)}</>}. Re-verifying replaces it
          &mdash; which is the way back in if you lose the device, and also means anyone who can
          sign in here can re-point it.
        </p>
      ) : (
        <button type="button" className={styles.btn} onClick={begin} disabled={busy}>
          {busy ? 'Preparing…' : 'Bind a World ID'}
        </button>
      )}

      <fieldset className={styles.policy} disabled={pending}>
        <legend className={styles.legend}>Require the bound human</legend>
        {POLICIES.map((p) => (
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
      </fieldset>

      {!enrolled && binding.policy !== 'off' && (
        <p className={styles.warn} role="alert">
          Nothing is bound yet, so approvals that need a human will be refused rather than
          waved through. Bind one above, or set this to <strong>Never</strong>.
        </p>
      )}

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
            // The server decides. Throwing here puts the widget in its own error state
            // rather than reporting a success the account never recorded.
            const state = await enrolHuman(result)
            if (state.kind !== 'done') throw new Error(state.kind === 'error' ? state.message : 'Enrolment failed.')
            setDone(true)
          }}
          onSuccess={() => setOpen(false)}
          onError={(code) => setError(`World ID could not verify: ${code}`)}
        />
      )}
    </section>
  )
}
