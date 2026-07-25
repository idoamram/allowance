import { describe, expect, it } from 'vitest'
import { driftExits, gate, remainingUsd, totalUsd } from './money'
import type { PlanMoneyView, StepInput } from './types'

/**
 * The spec's demo scenario, verbatim (latest.md §5): a 4-step wallet-vetting plan
 * quoted at $0.70 against a $1.20 ceiling. Steps 1–3 settle for $0.60. Step 4 was
 * an *estimate* of $0.10; the seller's live ask is $0.50 — 5× the estimate. The
 * envelope still holds $0.60, so the money is there. The gate blocks anyway,
 * because the plan the human approved is not the plan being executed.
 */
const step = (over: Partial<StepInput> = {}): StepInput => ({
  serviceUrl: 'https://seller.example/sanctions',
  serviceName: 'Sanctions screen',
  quoteUsd: 0.1,
  source: 'estimate',
  buys: 'OFAC SDN check on 3 addresses',
  why: 'A counterparty on a sanctions list voids the whole vetting',
  rail: 'worldchain',
  ...over,
})

const demoPlan: PlanMoneyView = {
  ceilingUsd: 1.2,
  fundedUsd: 1.2,
  tolerancePct: 20,
  steps: [
    { quoteUsd: 0.25, status: 'paid', paidUsd: 0.25 },
    { quoteUsd: 0.2, status: 'paid', paidUsd: 0.2 },
    { quoteUsd: 0.15, status: 'paid', paidUsd: 0.15 },
    { quoteUsd: 0.1, status: 'pending' },
  ],
}

const future = new Date('2026-07-26T09:00:00Z')
const now = new Date('2026-07-26T08:00:00Z')

describe('totalUsd / remainingUsd', () => {
  it('sums quotes at 6dp without float drift', () => {
    expect(totalUsd([{ quoteUsd: 0.25 }, { quoteUsd: 0.2 }, { quoteUsd: 0.15 }, { quoteUsd: 0.1 }])).toBe(0.7)
  })

  it('remaining is funded minus what actually settled', () => {
    expect(remainingUsd(demoPlan)).toBe(0.6)
  })
})

describe('gate — the demo drift', () => {
  it('blocks a 5× ask as drift even though the envelope could cover it', () => {
    const result = gate(step(), 0.5, remainingUsd(demoPlan), demoPlan.tolerancePct, now, future)
    expect(result).toEqual({
      ok: false,
      reason: 'drift',
      liveAskUsd: 0.5,
      maxAllowedUsd: 0.12, // 0.10 + 20% tolerance
      remainingUsd: 0.6,
    })
    // The point of the test: funds were sufficient and it still blocked.
    expect(result.remainingUsd).toBeGreaterThan(result.liveAskUsd)
  })

  it('passes an ask inside tolerance', () => {
    const result = gate(step(), 0.11, 0.6, 20, now, future)
    expect(result.ok).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('passes an ask exactly at the tolerance boundary', () => {
    expect(gate(step(), 0.12, 0.6, 20, now, future).ok).toBe(true)
  })

  it('blocks with over_remaining when tolerance is fine but the envelope is not', () => {
    // Quote 0.50, ask 0.55 (inside 20%), but only 0.30 left in the envelope.
    const result = gate(step({ quoteUsd: 0.5 }), 0.55, 0.3, 20, now, future)
    expect(result.reason).toBe('over_remaining')
    expect(result.ok).toBe(false)
  })

  it('blocks an expired plan before anything else', () => {
    const expired = new Date('2026-07-26T07:00:00Z')
    const result = gate(step(), 0.1, 0.6, 20, now, expired)
    expect(result.reason).toBe('expired')
  })

  it('a live-402 step still gates — a seller can change its price between probe and pay', () => {
    const result = gate(step({ source: 'live-402', quoteUsd: 0.02 }), 0.09, 0.6, 20, now, future)
    expect(result.reason).toBe('drift')
  })
})

describe('driftExits — the three priced ways out', () => {
  it('prices the demo exit: fits the ceiling, so no top-up', () => {
    expect(driftExits(demoPlan, 3, 0.5)).toEqual({
      topUpUsd: 0,
      abortReturnsUsd: 0.6,
      newTotalUsd: 1.1,
    })
  })

  it('asks for a top-up when the live ask pushes past the ceiling', () => {
    // Ask 0.75: new total 0.60 + 0.75 = 1.35, ceiling 1.20 → top up 0.15.
    expect(driftExits(demoPlan, 3, 0.75)).toEqual({
      topUpUsd: 0.15,
      abortReturnsUsd: 0.6,
      newTotalUsd: 1.35,
    })
  })

  it('counts still-unpaid steps beyond the blocked one in the new total', () => {
    const fiveStep: PlanMoneyView = {
      ...demoPlan,
      steps: [...demoPlan.steps, { quoteUsd: 0.2, status: 'pending' }],
    }
    // paid 0.60 + live ask 0.50 + the untouched 0.20 step = 1.30.
    expect(driftExits(fiveStep, 3, 0.5).newTotalUsd).toBe(1.3)
  })

  it('ignores skipped steps — a re-planned step is no longer owed', () => {
    const withSkip: PlanMoneyView = {
      ...demoPlan,
      steps: [...demoPlan.steps, { quoteUsd: 0.2, status: 'skipped' }],
    }
    expect(driftExits(withSkip, 3, 0.5).newTotalUsd).toBe(1.1)
  })
})
