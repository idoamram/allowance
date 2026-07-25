/**
 * Claimed vs settled — the matching itself, kept pure and free of `server-only` so it can
 * be tested directly. The IO around it lives in `claimed-vs-settled.ts`.
 *
 * `steps.receipt` is what the control plane SAYS it paid. The subgraph is what consensus
 * SAW settle. Diffing them lets an approver audit our backend without trusting our backend:
 * a payment we recorded that never landed, or money that moved and we never recorded, both
 * surface here. A subgraph that merely re-served our own rows would answer neither.
 */

/** USDC is 6dp on Worldchain — verified live 2026-07-25 via `decimals()`. */
const USDC_SCALE = 1_000_000

/** Claims and settlements are compared in atomic units; a unit of float drift is not a mismatch. */
export const MATCH_TOLERANCE_ATOMIC = 1

export function usdToAtomic(usd: number): number {
  return Math.round(usd * USDC_SCALE)
}

export function atomicToUsd(atomic: string | number): number {
  return Number(atomic) / USDC_SCALE
}

/** The shape `reconcile` needs from a subgraph settlement. */
export interface SettlementLike {
  id: string
  from: string
  to: string
  amount: string
  transactionHash: string
  blockTimestamp: string
}

export type ReconStatus = 'matched' | 'amount_mismatch' | 'unsettled' | 'unclaimed'
export type MatchedBy = 'tx_hash' | 'amount' | null

/** One payment our database claims we made. */
export interface Claim {
  planId: string
  stepIdx: number
  serviceName: string
  /** The plan wallet that should have sent it. */
  payer: string
  claimedUsd: number
  /** Transaction hash from the x402 settlement receipt, when the seller returned a readable one. */
  txRef: string | null
}

export interface ReconRow {
  status: ReconStatus
  matchedBy: MatchedBy
  planId: string | null
  stepIdx: number | null
  serviceName: string | null
  payer: string
  claimedUsd: number | null
  settledUsd: number | null
  settledTo: string | null
  txHash: string | null
  blockTimestamp: number | null
}

const isTxHash = (value: string | null): value is string =>
  !!value && /^0x[0-9a-f]{64}$/i.test(value)

/**
 * Match claims to on-chain settlements.
 *
 * Two passes on purpose. A transaction hash is proof; same-payer-same-amount is a plausible
 * guess. Hash matches are taken first so a weak amount match can never consume the
 * settlement a strong hash match was entitled to, and every row carries `matchedBy` so the
 * UI can state which kind of evidence it is showing rather than implying they are equal.
 */
export function reconcile(claims: Claim[], settlements: SettlementLike[]): ReconRow[] {
  const unconsumed = new Map<string, SettlementLike>()
  for (const s of settlements) unconsumed.set(s.id, s)

  const byTxHash = new Map<string, SettlementLike[]>()
  for (const s of settlements) {
    const key = s.transactionHash.toLowerCase()
    const bucket = byTxHash.get(key)
    if (bucket) bucket.push(s)
    else byTxHash.set(key, [s])
  }

  const rows: ReconRow[] = []
  const pending: Claim[] = []

  // Pass 1 — proof: the receipt's transaction hash is present on chain, from our wallet.
  for (const claim of claims) {
    if (!isTxHash(claim.txRef)) {
      pending.push(claim)
      continue
    }
    const candidates = (byTxHash.get(claim.txRef.toLowerCase()) ?? []).filter(
      (s) => unconsumed.has(s.id) && s.from.toLowerCase() === claim.payer.toLowerCase(),
    )
    if (candidates.length === 0) {
      pending.push(claim)
      continue
    }
    const claimedAtomic = usdToAtomic(claim.claimedUsd)
    const exact = candidates.find(
      (s) => Math.abs(Number(s.amount) - claimedAtomic) <= MATCH_TOLERANCE_ATOMIC,
    )
    const hit = exact ?? candidates[0]
    unconsumed.delete(hit.id)
    rows.push(toRow(claim, hit, exact ? 'matched' : 'amount_mismatch', 'tx_hash'))
  }

  // Pass 2 — inference: same payer, same amount, no hash to prove it.
  for (const claim of pending) {
    const claimedAtomic = usdToAtomic(claim.claimedUsd)
    let hit: SettlementLike | null = null
    for (const s of unconsumed.values()) {
      if (s.from.toLowerCase() !== claim.payer.toLowerCase()) continue
      if (Math.abs(Number(s.amount) - claimedAtomic) > MATCH_TOLERANCE_ATOMIC) continue
      hit = s
      break
    }
    if (hit) {
      unconsumed.delete(hit.id)
      rows.push(toRow(claim, hit, 'matched', 'amount'))
    } else {
      rows.push(toRow(claim, null, 'unsettled', null))
    }
  }

  // Anything left moved on chain from a plan wallet with no claim behind it. That direction
  // is invisible to our own database, and is the reason this panel reads from The Graph.
  for (const s of unconsumed.values()) {
    rows.push({
      status: 'unclaimed',
      matchedBy: null,
      planId: null,
      stepIdx: null,
      serviceName: null,
      payer: s.from,
      claimedUsd: null,
      settledUsd: atomicToUsd(s.amount),
      settledTo: s.to,
      txHash: s.transactionHash,
      blockTimestamp: Number(s.blockTimestamp),
    })
  }

  return rows.sort(
    (a, b) =>
      (a.planId ?? '￿').localeCompare(b.planId ?? '￿') ||
      (a.stepIdx ?? 0) - (b.stepIdx ?? 0),
  )
}

function toRow(
  claim: Claim,
  settlement: SettlementLike | null,
  status: ReconStatus,
  matchedBy: MatchedBy,
): ReconRow {
  return {
    status,
    matchedBy,
    planId: claim.planId,
    stepIdx: claim.stepIdx,
    serviceName: claim.serviceName,
    payer: claim.payer,
    claimedUsd: claim.claimedUsd,
    settledUsd: settlement ? atomicToUsd(settlement.amount) : null,
    settledTo: settlement?.to ?? null,
    txHash: settlement?.transactionHash ?? null,
    blockTimestamp: settlement ? Number(settlement.blockTimestamp) : null,
  }
}
