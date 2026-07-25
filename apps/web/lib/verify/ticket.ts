import { createHmac } from 'node:crypto'
import { safeEqual } from '../ids'

/**
 * Proof that *this* plan cleared step-up, issued by the server after — and only after —
 * the verifier said yes.
 *
 * Same shape and reasoning as `p/[id]/token.ts`: an HMAC keyed by the plan's approval key,
 * so a ticket is worthless on any other plan and reveals nothing about the key. The
 * difference is what it attests. The decision token says "the caller opened the approval
 * link". The step-up ticket says "a human satisfied the verifier for plan X". The approve
 * path needs both.
 *
 * It carries the plan id because the credential itself may not: some World presets return
 * `signal_hash: "0x0"`, so plan binding cannot rest on the proof alone. This is where it
 * actually rests.
 *
 * Ten minutes, because it is minted while the human is looking at the page. It is not a
 * session — walking away and coming back means proving again.
 */
const TTL_MS = 10 * 60 * 1000

const sign = (approvalKey: string, planId: string, verifierId: string, exp: number): string =>
  createHmac('sha256', approvalKey).update(`stepup.${verifierId}.${planId}.${exp}`).digest('base64url')

export function mintStepUpTicket(
  approvalKey: string,
  planId: string,
  verifierId: string,
  now = Date.now(),
): string {
  const exp = now + TTL_MS
  return `${exp}.${sign(approvalKey, planId, verifierId, exp)}`
}

export function verifyStepUpTicket(
  ticket: string,
  approvalKey: string,
  planId: string,
  verifierId: string,
  now = Date.now(),
): boolean {
  const [expRaw, mac] = ticket.split('.')
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || !mac || exp <= now) return false
  return safeEqual(mac, sign(approvalKey, planId, verifierId, exp))
}
