'use server'

import { headers } from 'next/headers'
import { supabaseServer } from '@/lib/supabase/server'

/**
 * What the login form knows after a submit — one value, not a bag of flags.
 *
 * A pair of independent booleans can represent "we told them a link is coming" and "the
 * send failed" at the same time, and a page that claims it sent an email it did not send
 * is the exact failure this product exists to argue against. A union cannot hold that
 * state at all: `sent` is only reachable when Supabase accepted the send.
 *
 * There is no `sending` member — `useActionState` reports that as `pending`, and a second
 * source of truth for the same fact is how the first bug got in.
 */
export type LoginState =
  | { kind: 'idle' }
  | { kind: 'sent'; email: string; notice?: string }
  | { kind: 'error'; message: string; email: string }

/** Enough to reject a typo before spending one of a small hourly allowance of sends. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Where the emailed link comes back to. The request's own host is preferred over
 * `APP_URL` so a dev server on any port, and a preview deployment on a URL nobody
 * configured, both round-trip to themselves rather than to production.
 */
async function origin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (host) return `${h.get('x-forwarded-proto') ?? 'http'}://${host}`
  return process.env.APP_URL ?? 'http://localhost:3000'
}

/**
 * Every failure here is something the reader can act on, so each gets its own sentence
 * and leads with the action. None of them name our vendor: who hosts the mail is our
 * problem, and a person staring at an error wants the next step, not our stack.
 */
function explain(message: string, status?: number): string {
  const m = message.toLowerCase()
  if (status === 429 || m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes')) {
    return 'Too many sign-in links requested. Wait a minute, then try again.'
  }
  if (m.includes('invalid') && m.includes('email')) {
    return 'That address was rejected. Check it for a typo.'
  }
  if (m.includes('signups not allowed') || m.includes('not allowed for this instance')) {
    return 'That address cannot sign in here. Use the one your account was set up with.'
  }
  return 'The link could not be sent. Try again in a moment.'
}

export async function sendMagicLink(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  if (!EMAIL.test(email)) {
    return { kind: 'error', message: 'Enter an email address, including the @ and a domain.', email }
  }

  const supabase = await supabaseServer()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await origin()}/auth/confirm` },
  })

  if (error) {
    const message = explain(error.message, error.status)
    // A failed resend must not retract a link that really was sent. Stay on the sent
    // screen — the address is still the useful thing on it — and say what just failed.
    if (prev.kind === 'sent' && prev.email === email) {
      return { kind: 'sent', email, notice: message }
    }
    return { kind: 'error', message, email }
  }

  return { kind: 'sent', email }
}
