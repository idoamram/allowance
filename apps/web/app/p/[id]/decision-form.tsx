'use client'

import { useActionState, useState } from 'react'
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

      {!rejecting ? (
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
            <p className={styles.hint}>
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
          >
            {pending ? 'Recording…' : approveLabel}
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
