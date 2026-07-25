import 'server-only'
import { createHmac } from 'node:crypto'
import { safeEqual } from '@/lib/ids'

/**
 * The form's proof that it was rendered from a link carrying the approval key —
 * without ever handing the key to the browser.
 *
 * The key is the only thing standing between a plan URL and someone approving spending
 * on it, so it stays server-side: it is never a client component prop, never a redirect
 * target, never logged. But a server action is addressable by anyone who can read the
 * client bundle, so the action still has to be convinced the caller held the key. This
 * token is that proof: an HMAC over (planId, expiry) keyed by the approval key itself.
 * Holding it authorises decisions on exactly one plan, for one hour, and it reveals
 * nothing about the key that minted it.
 */
const TTL_MS = 60 * 60 * 1000

const sign = (approvalKey: string, planId: string, exp: number): string =>
  createHmac('sha256', approvalKey).update(`${planId}.${exp}`).digest('base64url')

export function mintDecisionToken(approvalKey: string, planId: string, now = Date.now()): string {
  const exp = now + TTL_MS
  return `${exp}.${sign(approvalKey, planId, exp)}`
}

export function verifyDecisionToken(
  token: string,
  approvalKey: string,
  planId: string,
  now = Date.now(),
): boolean {
  const [expRaw, mac] = token.split('.')
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || !mac || exp <= now) return false
  return safeEqual(mac, sign(approvalKey, planId, exp))
}
