import { describe, expect, it } from 'vitest'
import { hashToken, newApprovalKey, newPlanId, safeEqual } from './ids'

describe('ids', () => {
  it('plan ids are prefixed and unique', () => {
    const a = newPlanId()
    expect(a).toMatch(/^pl_[A-Za-z0-9_-]{12}$/)
    expect(a).not.toBe(newPlanId())
  })

  it('approval keys are long enough not to be guessed', () => {
    const key = newApprovalKey()
    expect(key.length).toBeGreaterThanOrEqual(43) // 32 bytes base64url
    expect(key).not.toBe(newApprovalKey())
  })

  it('hashToken is stable and never returns the token', () => {
    expect(hashToken('pbt_secret')).toBe(hashToken('pbt_secret'))
    expect(hashToken('pbt_secret')).not.toContain('secret')
    expect(hashToken('pbt_secret')).toHaveLength(64)
  })

  it('safeEqual matches exactly and rejects length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})
