'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { submitDecision, type DecisionState } from './actions'
import { StepUp } from './step-up'
import styles from './approval.module.css'

/** The four things a "no" can be about. Typed, because free text alone teaches nothing. */
const TARGETS = [
  { value: 'price', label: 'Price', hint: 'the step is worth doing, not at that price' },
  { value: 'logic', label: 'Logic', hint: "the reasoning doesn't hold" },
  { value: 'scope', label: 'Scope', hint: "more than the goal needs" },
  { value: 'service', label: 'Service', hint: "wrong seller — down-ranks it in future discovery" },
] as const

/**
 * What this plan's ceiling demands of the human, when policy asks for more than the link.
 * `null` is the ordinary case and the default everywhere.
 */
export type StepUpRequirement = {
  ceilingLabel: string
  thresholdLabel: string
  /** Set when the verifier is selected but misconfigured — approval fails closed. */
  configError?: string
}

/**
 * What approving actually sets off, while it is happening.
 *
 * Approving is not a form post that returns — it mints a single-use account on Hedera,
 * schedules that account's own refund, and writes two records to a public consensus log.
 * On testnet that is ten to twenty seconds, and behind a disabled button reading
 * "Recording…" it was indistinguishable from a page that had died.
 *
 * The honesty rule this block is built on: it says only what the browser can know. The
 * elapsed count is measured from the submit and is real. The three acts are listed because
 * they are what is in flight, and they deliberately never tick — nothing here can observe
 * them landing individually, and a checklist ticking on a timer would be a lie about a
 * financial act told in the most convincing possible form.
 */
function Minting() {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const startedAt = Date.now()
    // Wall clock rather than a counter, so a backgrounded tab on a phone comes back with
    // the true elapsed time instead of however many ticks the browser felt like running.
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className={styles.minting} role="status">
      <p className={styles.mintingHead}>
        <b>Funding the envelope</b>
        <span className={styles.elapsed} aria-hidden="true">
          {String(seconds).padStart(2, '0')}s
        </span>
      </p>

      <div className={styles.scale} aria-hidden="true">
        <div className={styles.scaleSweep} />
      </div>

      <ul className={styles.mintingActs}>
        <li>Minting a single-use account that holds only this plan&rsquo;s money</li>
        <li>Scheduling its own refund, so the remainder returns with no keeper to trust</li>
        <li>Writing two records to the consensus log: your approval, and the ceiling</li>
      </ul>

      <p className={styles.mintingFoot}>
        Ten to twenty seconds is normal &mdash; that is consensus, not this page hanging. The
        steps are not ticked off because the browser cannot watch them land; the count is the
        one thing it knows.
      </p>
    </div>
  )
}

export function DecisionForm({
  planId,
  token,
  approveLabel,
  steps,
  stepUp = null,
}: {
  planId: string
  /** Proof this form was rendered from the approval link. Not the approval key itself. */
  token: string
  approveLabel: string
  steps: { idx: number; name: string }[]
  stepUp?: StepUpRequirement | null
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(
    submitDecision.bind(null, planId),
    {},
  )
  const [rejecting, setRejecting] = useState(false)
  const [stepUpTicket, setStepUpTicket] = useState('')

  // Which of the two answers is in flight. Presentation only — the form still submits
  // exactly what it always did — but the two waits are nothing alike: a rejection writes a
  // row, an approval mints an account and waits on consensus. Telling them apart is the
  // difference between "Recording…" and a screen that explains a twenty-second pause.
  const [approving, setApproving] = useState(false)
  const wasPending = useRef(false)
  useEffect(() => {
    // Clear only on the falling edge. Clearing whenever `pending` is false would fire on
    // the render between the click and the action starting, and undo the flag immediately.
    if (wasPending.current && !pending) setApproving(false)
    wasPending.current = pending
  }, [pending])

  // Rejecting is always available: a "no" funds nothing, so gating it would only buy
  // friction. It is approval — the act that moves money — that has to clear the bar.
  const blockedByStepUp = stepUp !== null && stepUpTicket === ''

  if (state.ok) {
    // The page revalidates behind this, so the settled state is one reload away — but say
    // it here immediately: the human's answer landing is the whole point of the screen.
    return (
      <div className={styles.settled} role="status">
        <h2>{state.status === 'approved' ? 'Approved' : 'Recorded'}</h2>
        <p>
          {state.status === 'approved'
            ? 'The envelope is funded to this ceiling. You can close this page.'
            : 'Your answer is recorded, and it is what shapes the next plan.'}
        </p>
      </div>
    )
  }

  return (
    <form action={action} className={styles.actions}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="stepUpTicket" value={stepUpTicket} />

      {pending && approving ? (
        <Minting />
      ) : !rejecting ? (
        <>
          {stepUp?.configError ? (
            <p className={styles.error} role="alert">
              Step-up verification is required for this ceiling but is not configured
              correctly, so nothing can be funded from this page. {stepUp.configError}
            </p>
          ) : (
            stepUp !== null &&
            stepUpTicket === '' && (
              <StepUp
                planId={planId}
                token={token}
                ceilingLabel={stepUp.ceilingLabel}
                thresholdLabel={stepUp.thresholdLabel}
                onVerified={setStepUpTicket}
              />
            )
          )}
          {stepUp !== null && stepUpTicket !== '' && (
            <p className={`${styles.hint} ${styles.confirmedHint}`}>
              <span className={`${styles.stamp} ${styles.stampGood}`}>human confirmed</span>{' '}
              Verified for this plan only, for the next ten minutes.
            </p>
          )}

          <button
            type="submit"
            name="outcome"
            value="approved"
            className={`${styles.btn} ${styles.approve}`}
            disabled={pending || blockedByStepUp}
            onClick={() => setApproving(true)}
          >
            {approveLabel}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.ghost}`}
            onClick={() => setRejecting(true)}
            disabled={pending}
          >
            Reject with reason
          </button>
        </>
      ) : (
        <div className={styles.rejectPanel}>
          <p className={styles.legend}>What is the objection about?</p>
          <p className={styles.hint}>
            Required. A typed &ldquo;no&rdquo; is the only thing the system learns from &mdash;
            it never widens what the agent may spend, only narrows what it asks for.
          </p>
          <fieldset className={styles.targets}>
            {TARGETS.map((t) => (
              <label key={t.value} className={styles.target} title={t.hint}>
                <input type="radio" name="target" value={t.value} required />
                {t.label}
              </label>
            ))}
          </fieldset>

          <label className={styles.label} htmlFor="stepIdx">
            Which step? (optional)
          </label>
          <select id="stepIdx" name="stepIdx" className={styles.select} defaultValue="">
            <option value="">The plan as a whole</option>
            {steps.map((s) => (
              <option key={s.idx} value={s.idx}>
                {s.idx + 1}. {s.name}
              </option>
            ))}
          </select>

          <label className={styles.label} htmlFor="reason">
            In your words
          </label>
          <textarea
            id="reason"
            name="reason"
            className={styles.textarea}
            required
            maxLength={1000}
            placeholder="e.g. sanctions screening is guesswork at that price — find a live-quoted seller"
          />

          <button
            type="submit"
            name="outcome"
            value="rejected"
            className={`${styles.btn} ${styles.danger}`}
            disabled={pending}
          >
            {pending ? 'Recording…' : 'Send rejection'}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.ghost}`}
            onClick={() => setRejecting(false)}
            disabled={pending}
          >
            Back
          </button>
        </div>
      )}

      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
    </form>
  )
}
