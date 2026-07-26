import type { CSSProperties } from 'react'
import { driftExits } from '@planbound/core'
import type { PlanMoneyView, StepStatus } from '@planbound/core'
import { usd } from '@/lib/format'
import { DriftActions } from './drift-actions'
import styles from './approval.module.css'

export interface DriftStep {
  idx: number
  serviceName: string
  buys: string
  quoteUsd: number
  status: StepStatus
  paidUsd?: number
  liveAskUsd?: number
}

/**
 * The moment the product exists for.
 *
 * A step asked more than it quoted, the gate refused to pay it, and now the human needs
 * three things a per-transaction popup never gives them: what their money already bought,
 * what changed, and what each way out costs. Sunk cost is stated plainly — it does not
 * come back under any option, and pretending otherwise would make the abort price a lie.
 */
export function DriftDiff({
  planId,
  ticket,
  money,
  steps,
  blockedIdx,
  liveAskUsd,
}: {
  planId: string
  ticket: string
  money: PlanMoneyView
  steps: DriftStep[]
  blockedIdx: number
  liveAskUsd: number
}) {
  const blocked = steps.find((s) => s.idx === blockedIdx)
  const paid = steps.filter((s) => s.status === 'paid')
  const exits = driftExits(money, blockedIdx, liveAskUsd)
  const spent = paid.reduce((sum, s) => sum + (s.paidUsd ?? 0), 0)
  const multiple = blocked && blocked.quoteUsd > 0 ? liveAskUsd / blocked.quoteUsd : 0

  // The same envelope scale the approval sheet drew, now answering the only question
  // the exits turn on: does the new total still fit under the ceiling?
  const ceiling = money.ceilingUsd
  const fillPct = ceiling > 0 ? Math.min(100, (exits.newTotalUsd / ceiling) * 100) : 0
  const overCeiling = exits.topUpUsd > 0

  return (
    <section className={`${styles.block} ${styles.drift}`}>
      <div className={styles.driftHead}>
        <span className={styles.driftBadge}>Blocked on drift</span>
        <span className={styles.driftLead}>
          {blocked?.serviceName ?? 'A step'} now asks {usd(liveAskUsd)} — it quoted{' '}
          {usd(blocked?.quoteUsd ?? 0)}
          {multiple >= 2 && <b> ({multiple.toFixed(0)}×)</b>}. Nothing was paid for it.
        </span>
      </div>

      <ol className={styles.driftSteps}>
        {steps.map((s) => {
          const isBlocked = s.idx === blockedIdx
          return (
            <li
              key={s.idx}
              className={isBlocked ? styles.driftStepBlocked : styles.driftStep}
              data-status={s.status}
            >
              <span className={styles.driftMark}>
                {s.status === 'paid' ? '✓' : isBlocked ? '✕' : '·'}
              </span>
              <span className={styles.driftBody}>
                <b>{s.serviceName}</b>
                <span className={styles.driftBuys}>{s.buys}</span>
              </span>
              <span className={styles.driftPrice}>
                {s.status === 'paid' ? (
                  usd(s.paidUsd ?? 0)
                ) : isBlocked ? (
                  <>
                    <s>{usd(s.quoteUsd)}</s> → <b>{usd(liveAskUsd)}</b>
                  </>
                ) : (
                  <span className={styles.driftPending}>{usd(s.quoteUsd)} not started</span>
                )}
              </span>
            </li>
          )
        })}
      </ol>

      <dl className={styles.driftMoney}>
        <div>
          <dt>Spent · kept either way</dt>
          <dd>{usd(spent)}</dd>
        </div>
        <div>
          <dt>Left in envelope</dt>
          <dd>{usd(exits.abortReturnsUsd)}</dd>
        </div>
        <div>
          <dt>New total if approved</dt>
          <dd>
            {usd(exits.newTotalUsd)}
            {exits.topUpUsd > 0 && (
              <span className={styles.driftOver}> · {usd(exits.topUpUsd)} over ceiling</span>
            )}
          </dd>
        </div>
      </dl>

      <div className={styles.driftScale}>
        <span className={styles.envelopeLabel}>
          New total against the {usd(ceiling)} ceiling
        </span>
        <div className={styles.scale}>
          <div
            className={`${styles.scaleFill} ${overCeiling ? styles.scaleOver : ''}`}
            style={{ '--fill': `${fillPct.toFixed(1)}%` } as CSSProperties}
          />
        </div>
      </div>

      <DriftActions
        planId={planId}
        ticket={ticket}
        stepIdx={blockedIdx}
        approveLabel={
          exits.topUpUsd > 0
            ? `Approve step · top up ${usd(exits.topUpUsd)}`
            : `Approve step at ${usd(liveAskUsd)}`
        }
        abortLabel={`Abort · ${usd(exits.abortReturnsUsd)} back`}
      />

      <p className={styles.driftFoot}>
        The agent stopped here because the plan you approved is not the plan it found. Your
        money is still in the envelope; {usd(spent)} of it already bought the steps above.
      </p>
    </section>
  )
}
