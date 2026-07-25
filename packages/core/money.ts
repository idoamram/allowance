/**
 * The money math. Every number a human approves or an agent spends passes through here.
 *
 * Invariants (tested in money.test.ts, stated in the plan's Global Constraints):
 *   ceiling >= total · remaining = funded − Σpaid
 *   a step is blocked when liveAsk > quote × (1 + tolerance) OR liveAsk > remaining
 *
 * All amounts are USD carried at 6 decimal places — USDC's precision, and enough for
 * HBAR converted at a fixed demo rate. Every operation rounds, because IEEE floats
 * turn 0.25 + 0.2 + 0.15 into 0.6000000000000001 and a human reading $0.60 on an
 * approval page should never see that.
 */
import type { DriftExits, GateResult, PlanMoneyView, StepInput } from './types'

const DP = 6

export const round6 = (n: number): number => Number(n.toFixed(DP))

/** Sum of quoted prices — what the plan claims it will cost. */
export const totalUsd = (steps: { quoteUsd: number }[]): number =>
  round6(steps.reduce((sum, s) => sum + s.quoteUsd, 0))

/** Sum of what actually settled. */
export const paidUsd = (steps: { paidUsd?: number }[]): number =>
  round6(steps.reduce((sum, s) => sum + (s.paidUsd ?? 0), 0))

/** What is still in the envelope: funded minus settled. */
export const remainingUsd = (plan: PlanMoneyView): number =>
  round6(plan.fundedUsd - paidUsd(plan.steps))

/** The most a step may cost and still be the step that was approved. */
export const maxAllowedUsd = (quoteUsd: number, tolerancePct: number): number =>
  round6(quoteUsd * (1 + tolerancePct / 100))

/**
 * The gate. Called with the seller's *live* ask immediately before paying — never with
 * the quote from planning time, which is exactly the gap drift lives in.
 *
 * Blocks in order of what the human most needs to know: an expired plan is not a
 * pricing question; drift explains *why* the money isn't being spent even when it
 * could be; over_remaining is the plain "not enough left" case.
 */
export function gate(
  step: Pick<StepInput, 'quoteUsd'>,
  liveAskUsd: number,
  remaining: number,
  tolerancePct: number,
  now: Date,
  expiresAt: Date,
): GateResult {
  const ceiling = maxAllowedUsd(step.quoteUsd, tolerancePct)
  const base = {
    liveAskUsd: round6(liveAskUsd),
    maxAllowedUsd: ceiling,
    remainingUsd: round6(remaining),
  }

  if (now >= expiresAt) return { ok: false, reason: 'expired', ...base }
  if (base.liveAskUsd > ceiling) return { ok: false, reason: 'drift', ...base }
  if (base.liveAskUsd > base.remainingUsd) return { ok: false, reason: 'over_remaining', ...base }
  return { ok: true, ...base }
}

/**
 * Price the three ways out of a blocked plan, for the drift diff the human sees:
 * approve the live ask (possibly topping up), re-plan the step, or abort and take
 * back what is left. Sunk cost is never returned — that's the honest part.
 */
export function driftExits(
  plan: PlanMoneyView,
  blockedIdx: number,
  liveAskUsd: number,
): DriftExits {
  const settled = paidUsd(plan.steps)

  // Steps still owed if the plan continues: everything pending except the blocked one
  // (which is priced at its live ask instead). Skipped steps are no longer owed.
  const stillOwed = plan.steps.reduce(
    (sum, s, i) => (i !== blockedIdx && s.status === 'pending' ? sum + s.quoteUsd : sum),
    0,
  )

  const newTotalUsd = round6(settled + liveAskUsd + stillOwed)

  return {
    topUpUsd: round6(Math.max(0, newTotalUsd - plan.ceilingUsd)),
    abortReturnsUsd: remainingUsd(plan),
    newTotalUsd,
  }
}
