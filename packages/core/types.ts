/**
 * The shared vocabulary. Mirrors `plans/product-spec/latest.md` §5.
 * FROZEN once C3 merges — changes route through the control tower.
 */

/** Where a step's price came from. Drives the [live]/[est.] badge the human sees. */
export type QuoteSource = 'live-402' | 'estimate'

/** Settlement rail, in the priority order of the 2026-07-25 rails amendment. */
export type Rail = 'hedera' | 'worldchain' | 'base'

export type PlanStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'blocked'
  | 'settled'
  | 'aborted'
  | 'expired'

export type StepStatus = 'pending' | 'paid' | 'blocked' | 'skipped'

export type DecisionOutcome =
  | 'approved'
  | 'rejected'
  | 'edited'
  | 'drift_approved'
  | 'drift_replan'
  | 'drift_abort'

/** What a rejection was actually about — the typed signal the learning loop reads. */
export type DecisionTarget = 'price' | 'logic' | 'scope' | 'service'

export interface StepInput {
  serviceUrl: string
  serviceName: string
  quoteUsd: number
  source: QuoteSource
  /** What this step buys, in the human's terms. */
  buys: string
  /** One line: why this step is in the plan at all. */
  why: string
  rail: Rail
}

export interface PlanInput {
  goal: string
  /** The plan's logic in one line — how the steps add up to the goal. */
  approach: string
  steps: StepInput[]
  ceilingUsd: number
  /** How far above its quote a step may drift before the gate blocks. */
  tolerancePct: number
  expiresInMin: number
  selfCheck: { turns: number; fixes: string[] }
}

export interface GateResult {
  ok: boolean
  reason?: 'drift' | 'over_remaining' | 'expired'
  liveAskUsd: number
  /** The most this step could cost and still pass tolerance. */
  maxAllowedUsd: number
  remainingUsd: number
}

/** The money-relevant projection of a plan — what the gates and exits reason over. */
export interface PlanMoneyView {
  ceilingUsd: number
  /** What the envelope was actually funded with (the approved ceiling, in practice). */
  fundedUsd: number
  tolerancePct: number
  steps: StepMoneyView[]
}

export interface StepMoneyView {
  quoteUsd: number
  status: StepStatus
  /** Set once the step settles. */
  paidUsd?: number
}

/** The three priced ways out of a blocked plan, as shown on the drift diff. */
export interface DriftExits {
  /** Extra funding needed to approve the live ask — 0 when it still fits the ceiling. */
  topUpUsd: number
  /** What comes back if the human aborts now (sunk cost stays sunk). */
  abortReturnsUsd: number
  /** What the plan costs in total if the live ask is approved. */
  newTotalUsd: number
}
