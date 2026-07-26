import { describe, expect, it } from 'vitest'
import { checkBinding, verificationRequired, type HumanBinding } from './human-policy'

const bound = (nullifier: string | null): HumanBinding => ({
  nullifier,
  preset: nullifier ? 'selfieCheckLegacy' : null,
  policy: 'always',
  boundAt: nullifier ? '2026-07-26T00:00:00Z' : null,
})

describe('checkBinding — which human, not whether a human', () => {
  it('accepts the human the account enrolled', () => {
    expect(checkBinding(bound('0xalice'), '0xalice')).toEqual({ ok: true })
  })

  it('refuses a valid proof from a different World ID', () => {
    // The whole point. A leaked approval link plus a real, live, honestly-verified human is
    // exactly the attack proof-of-human alone cannot see: the stranger is a human, and the
    // liveness check is satisfied. Only continuity catches it.
    const check = checkBinding(bound('0xalice'), '0xmallory')
    expect(check.ok).toBe(false)
    expect(check).toMatchObject({ code: 'different_human' })
  })

  it('refuses when the policy demands a bound human and none is enrolled', () => {
    // Failing closed. A control that requires something nobody configured, and then allows
    // the action anyway, is decoration — and it reads as protection in exactly the moment
    // it is providing none.
    const check = checkBinding(bound(null), '0xalice')
    expect(check.ok).toBe(false)
    expect(check).toMatchObject({ code: 'not_enrolled' })
  })

  it('refuses a proof that carried no nullifier', () => {
    // `none` in development, or a preset that omits it. The liveness claim may be perfectly
    // good; it simply cannot answer the question being asked here.
    const check = checkBinding(bound('0xalice'), undefined)
    expect(check.ok).toBe(false)
    expect(check).toMatchObject({ code: 'different_human' })
  })
})

describe('verificationRequired', () => {
  it('off never asks, whatever the ceiling', () => {
    expect(verificationRequired('off', 10_000, 5)).toBe(false)
  })

  it('always asks, even for a trivial ceiling', () => {
    expect(verificationRequired('always', 0.01, 5)).toBe(true)
  })

  it('threshold asks only above the step-up line', () => {
    expect(verificationRequired('threshold', 5, 5)).toBe(false)
    expect(verificationRequired('threshold', 5.01, 5)).toBe(true)
  })
})
