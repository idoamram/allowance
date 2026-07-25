import { describe, expect, it } from 'vitest'
import { type Claim, type SettlementLike, reconcile } from './reconcile'

const WALLET = '0x1111111111111111111111111111111111111111'
const OTHER_WALLET = '0x2222222222222222222222222222222222222222'
const SELLER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TX_A = `0x${'a'.repeat(64)}`
const TX_B = `0x${'b'.repeat(64)}`

function settlement(over: Partial<SettlementLike> = {}): SettlementLike {
  return {
    id: 'settlement-1',
    from: WALLET,
    to: SELLER,
    amount: '20000', // $0.02 in USDC atomic units
    transactionHash: TX_A,
    blockTimestamp: '1753440000',
    ...over,
  }
}

function claim(over: Partial<Claim> = {}): Claim {
  return {
    planId: 'pl_one',
    stepIdx: 0,
    serviceName: 'Carbon & Cashmere',
    payer: WALLET,
    claimedUsd: 0.02,
    txRef: TX_A,
    ...over,
  }
}

describe('reconcile — the approver checking our backend against consensus', () => {
  it('matches on transaction hash and says so', () => {
    const [row] = reconcile([claim()], [settlement()])
    expect(row.status).toBe('matched')
    expect(row.matchedBy).toBe('tx_hash')
    expect(row.settledUsd).toBe(0.02)
  })

  it('flags a settlement whose amount disagrees with what we claimed', () => {
    const [row] = reconcile([claim({ claimedUsd: 0.02 })], [settlement({ amount: '50000' })])
    expect(row.status).toBe('amount_mismatch')
    expect(row.claimedUsd).toBe(0.02)
    expect(row.settledUsd).toBe(0.05)
  })

  it('reports a claimed payment with nothing on chain as unsettled', () => {
    const rows = reconcile([claim()], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('unsettled')
    expect(rows[0].settledUsd).toBeNull()
  })

  it('surfaces money that moved from a plan wallet with no claim behind it', () => {
    const rows = reconcile([], [settlement()])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('unclaimed')
    expect(rows[0].claimedUsd).toBeNull()
    expect(rows[0].settledUsd).toBe(0.02)
  })

  it('falls back to payer+amount when the receipt carried no usable tx hash', () => {
    const [row] = reconcile([claim({ txRef: 'unknown' })], [settlement()])
    expect(row.status).toBe('matched')
    // The weaker evidence is labelled, never presented as proof.
    expect(row.matchedBy).toBe('amount')
  })

  it('never lets an amount guess consume the settlement a hash match is entitled to', () => {
    const claims = [
      claim({ stepIdx: 0, txRef: 'unknown' }),
      claim({ stepIdx: 1, txRef: TX_B }),
    ]
    const settlements = [
      settlement({ id: 's-a', transactionHash: TX_A }),
      settlement({ id: 's-b', transactionHash: TX_B }),
    ]
    const rows = reconcile(claims, settlements)
    const hashRow = rows.find((r) => r.stepIdx === 1)!
    const guessRow = rows.find((r) => r.stepIdx === 0)!
    expect(hashRow.matchedBy).toBe('tx_hash')
    expect(hashRow.txHash).toBe(TX_B)
    expect(guessRow.matchedBy).toBe('amount')
    expect(guessRow.txHash).toBe(TX_A)
    expect(rows.every((r) => r.status === 'matched')).toBe(true)
  })

  it('will not match a settlement sent by a different wallet', () => {
    const rows = reconcile([claim()], [settlement({ from: OTHER_WALLET })])
    expect(rows.map((r) => r.status).sort()).toEqual(['unclaimed', 'unsettled'])
  })

  it('tolerates a single atomic unit of rounding, but not a cent', () => {
    const near = reconcile([claim({ claimedUsd: 0.02 })], [settlement({ amount: '20001' })])
    expect(near[0].status).toBe('matched')
    const off = reconcile([claim({ claimedUsd: 0.02 })], [settlement({ amount: '30000' })])
    expect(off[0].status).toBe('amount_mismatch')
  })

  it('is case-insensitive about addresses and hashes', () => {
    const [row] = reconcile(
      [claim({ payer: WALLET.toUpperCase().replace('0X', '0x'), txRef: TX_A.toUpperCase().replace('0X', '0x') })],
      [settlement()],
    )
    expect(row.status).toBe('matched')
    expect(row.matchedBy).toBe('tx_hash')
  })
})
