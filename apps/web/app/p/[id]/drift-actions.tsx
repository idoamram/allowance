'use client'

import { useActionState } from 'react'
import { submitDriftDecision, type DecisionState } from './actions'
import styles from './approval.module.css'

/**
 * The three ways out, each priced in its own label. No default, no primary styling on the
 * cheapest one — the point is that the human chooses knowing what each costs, not that we
 * nudge them toward the outcome that keeps the plan alive.
 */
export function DriftActions({
  planId,
  ticket,
  stepIdx,
  approveLabel,
  abortLabel,
}: {
  planId: string
  ticket: string
  stepIdx: number
  approveLabel: string
  abortLabel: string
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(submitDriftDecision, {})

  return (
    <form action={action} className={styles.driftActions}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="token" value={ticket} />
      <input type="hidden" name="stepIdx" value={stepIdx} />

      <button name="outcome" value="drift_approved" disabled={pending} className={styles.driftBtn}>
        {approveLabel}
      </button>
      <button name="outcome" value="drift_replan" disabled={pending} className={styles.driftBtn}>
        Re-plan this step
      </button>
      <button name="outcome" value="drift_abort" disabled={pending} className={styles.driftBtnStop}>
        {abortLabel}
      </button>

      {state.error && <p className={styles.driftError}>{state.error}</p>}
    </form>
  )
}
