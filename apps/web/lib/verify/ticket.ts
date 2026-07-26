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
 * It also carries the **nullifier**, signed rather than merely accompanying, so the approve
 * path can ask *which* human proved it. Without that the ticket says only "somebody alive"
 * — which is the right answer to "is this an agent" and no answer at all to "is this the
 * account's human". A nullifier passed alongside an unsigned ticket would be a value the
 * client chooses, which is worse than not checking.
 *
 * Ten minutes, because it is minted while the human is looking at the page. It is not a
 * session — walking away and coming back means proving again.
 */
const TTL_MS = 10 * 60 * 1000

const sign = (
  approvalKey: string,
  planId: string,
  verifierId: string,
  nullifier: string,
  exp: number,
): string =>
  createHmac('sha256', approvalKey)
    .update(`stepup.${verifierId}.${planId}.${nullifier}.${exp}`)
    .digest('base64url')

/**
 * `nullifier` is empty when the verifier returned none — `none` in development, or a preset
 * that omits it. The ticket stays valid for the liveness claim; it simply cannot support a
 * binding check, and `checkBinding` refuses rather than guesses.
 */
export function mintStepUpTicket(
  approvalKey: string,
  planId: string,
  verifierId: string,
  nullifier = '',
  now = Date.now(),
): string {
  const exp = now + TTL_MS
  const mac = sign(approvalKey, planId, verifierId, nullifier, exp)
  // The nullifier travels in the clear *and* under the MAC: the approve path needs to read
  // it, and signing it is what stops the client choosing a different one.
  return `${exp}.${encodeURIComponent(nullifier)}.${mac}`
}

export interface TicketCheck {
  valid: boolean
  /** The nullifier this ticket was minted for, once the MAC has vouched for it. */
  nullifier?: string
}

export function verifyStepUpTicket(
  ticket: string,
  approvalKey: string,
  planId: string,
  verifierId: string,
  now = Date.now(),
): TicketCheck {
  const [expRaw, nullifierRaw, mac] = ticket.split('.')
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || !mac || nullifierRaw === undefined || exp <= now) {
    return { valid: false }
  }
  let nullifier: string
  try {
    nullifier = decodeURIComponent(nullifierRaw)
  } catch {
    return { valid: false }
  }
  if (!safeEqual(mac, sign(approvalKey, planId, verifierId, nullifier, exp))) {
    return { valid: false }
  }
  return { valid: true, nullifier: nullifier || undefined }
}
