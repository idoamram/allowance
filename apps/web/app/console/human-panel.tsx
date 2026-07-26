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

const policies = (threshold: string): { value: VerificationPolicy; label: string; detail: string }[] => [
  {
    value: 'off',
    label: 'Never ask',
    detail: 'Anyone with the approval link can approve. Fastest, and the least protected.',
  },
  {
    value: 'threshold',
    label: `Ask for plans over ${threshold}`,
    detail: `Small plans approve straight from the link. Anything above ${threshold} needs your World ID.`,
  },
  {
    value: 'always',
    label: 'Ask every time',
    detail: 'Every plan needs your World ID, however small.',
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
export function HumanPanel({ binding, threshold }: { binding: HumanBinding; threshold: string }) {
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
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

  const enrolled = Boolean(binding.nullifier) || done

  return (
    <section className={styles.panel} id="human">
      <p className={styles.eyebrow}>Identity</p>
      <h2 className={styles.title}>Who may approve</h2>

      <p className={styles.status}>
        <span className={enrolled ? styles.dotOn : styles.dotOff} aria-hidden="true" />
        {enrolled ? (
          <>
            <strong>Your World ID is connected.</strong> Approvals that need a human must come
            from you.
          </>
        ) : (
          <>
            <strong>No World ID connected.</strong> Anyone holding an approval link can
            approve.
          </>
        )}
      </p>

      <p className={styles.sub}>
        When an agent submits a plan it is handed the approval link for that plan. Connecting
        your World ID means an approval has to come from <em>you</em> &mdash; not the agent,
        and not anyone else who ends up with the link.
      </p>

      <p className={styles.note}>
        We learn nothing about who you are. World gives us one scrambled value that stays the
        same for you and is different for everyone else &mdash; enough to recognise you again,
        and nothing more.
      </p>

      {enrolled ? (
        <p className={styles.bound}>
          Connected{binding.boundAt && <> on {binding.boundAt.slice(0, 10)}</>}
          {binding.preset && <> using <code>{binding.preset}</code></>}. Connecting a different
          World ID replaces this one &mdash; that is how you get back in if you lose the phone,
          and it also means anyone who can sign in here could change it.
        </p>
      ) : (
        <button type="button" className={styles.btn} onClick={begin} disabled={busy}>
          {busy ? 'Preparing…' : 'Connect your World ID'}
        </button>
      )}

      <fieldset className={styles.policy} disabled={pending}>
        <legend className={styles.legend}>Require the bound human</legend>
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
      </fieldset>

      {!enrolled && binding.policy !== 'off' && (
        <p className={styles.warn} role="alert">
          No World ID is connected, so plans that need one are being turned away rather than
          waved through. Connect one above, or choose <strong>Never ask</strong>.
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
            setError(null)
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
