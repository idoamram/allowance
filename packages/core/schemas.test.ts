import { describe, expect, it } from 'vitest'
import { decisionSchema, planInputSchema } from './schemas'

const validPlan = {
  goal: 'Vet 3 counterparty wallets before I pay them',
  approach: 'Screen each address for sanctions, then price the risk of the two that clear',
  steps: [
    {
      serviceUrl: 'https://api.example.com/screen',
      serviceName: 'Sanctions screen',
      quoteUsd: 0.3,
      source: 'live-402' as const,
      buys: 'OFAC SDN check on 3 addresses',
      why: 'A sanctioned counterparty voids the rest of the vetting',
      rail: 'worldchain' as const,
    },
  ],
  ceilingUsd: 0.5,
  tolerancePct: 20,
  expiresInMin: 60,
  selfCheck: { turns: 2, fixes: ['dropped a dead endpoint'] },
}

describe('planInputSchema', () => {
  it('accepts a well-formed plan', () => {
    expect(planInputSchema.safeParse(validPlan).success).toBe(true)
  })

  it('rejects a ceiling below the sum of quotes — the core money invariant', () => {
    const result = planInputSchema.safeParse({ ...validPlan, ceilingUsd: 0.2 })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toMatch(/at least the sum/)
  })

  it('accepts a ceiling exactly equal to the total', () => {
    expect(planInputSchema.safeParse({ ...validPlan, ceilingUsd: 0.3 }).success).toBe(true)
  })

  it('rejects an unknown rail', () => {
    const bad = { ...validPlan, steps: [{ ...validPlan.steps[0], rail: 'solana' }] }
    expect(planInputSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a step with no why — an unexplained step is the thing we exist to prevent', () => {
    const bad = { ...validPlan, steps: [{ ...validPlan.steps[0], why: '' }] }
    expect(planInputSchema.safeParse(bad).success).toBe(false)
  })
})

describe('decisionSchema', () => {
  it('accepts a plain approval', () => {
    expect(decisionSchema.safeParse({ outcome: 'approved' }).success).toBe(true)
  })

  it('requires a typed target and reason on rejection — that is the learning signal', () => {
    expect(decisionSchema.safeParse({ outcome: 'rejected' }).success).toBe(false)
    expect(
      decisionSchema.safeParse({ outcome: 'rejected', target: 'price', reason: 'too dear for a scan' })
        .success,
    ).toBe(true)
  })

  it('accepts the three drift exits', () => {
    for (const outcome of ['drift_approved', 'drift_replan', 'drift_abort']) {
      expect(decisionSchema.safeParse({ outcome, stepIdx: 3 }).success).toBe(true)
    }
  })
})
