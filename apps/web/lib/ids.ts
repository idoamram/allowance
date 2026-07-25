import { createHash, randomBytes } from 'node:crypto'

/** Plan ids are human-quotable in a demo and unguessable enough to be a URL segment. */
export const newPlanId = (): string => `pl_${randomBytes(9).toString('base64url')}`

/**
 * The approval key is the only thing standing between a plan URL and someone
 * approving spending on it — 32 bytes, never logged, never in a redirect.
 */
export const newApprovalKey = (): string => randomBytes(32).toString('base64url')

/** Agent bearer tokens are stored only as their hash. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex')

/** Constant-time compare so a wrong key can't be found by timing the response. */
export const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
