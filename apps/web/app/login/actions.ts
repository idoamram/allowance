'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'

/**
 * What the login form knows after a submit — one value, not a bag of flags.
 *
 * A pair of independent booleans can represent "we told them a code is coming" and "the
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
 * Every failure here is something the reader can act on, so each gets its own sentence and
 * leads with the action. None of them name our vendor: who hosts the mail is our problem,
 * and a person staring at an error wants the next step, not our stack.
 */
function explain(message: string, status?: number): string {
  const m = message.toLowerCase()
  if (
    status === 429 ||
    m.includes('rate limit') ||
    m.includes('too many') ||
    m.includes('for security purposes')
  ) {
    return 'Too many codes requested. Wait a minute, then try again.'
  }
  if (m.includes('invalid') && m.includes('email')) {
    return 'That address was rejected. Check it for a typo.'
  }
  if (m.includes('signups not allowed') || m.includes('not allowed for this instance')) {
    return 'That address cannot sign in here. Use the one your account was set up with.'
  }
  return 'The code could not be sent. Try again in a moment.'
}

/**
 * Send a six-digit code rather than a link.
 *
 * Same call either way — Supabase decides from the email template: `{{ .Token }}` sends a
 * code, `{{ .ConfirmationURL }}` sends a link. A code is deliberate here. A link comes back
 * in one of three shapes (fragment tokens, a PKCE code, a token hash) depending on project
 * settings and on whether it was emailed or minted through the Admin API, and each shape
 * needs its own handling; all three were hit in one night. A typed code has no return trip
 * to get wrong, survives being opened on a different device, and cannot be consumed by a
 * mail scanner prefetching links.
 *
 * `emailRedirectTo` must be set even though we ask for a code, and getting this wrong cost
 * a real sign-in: it was removed on the reasoning that a code needs no redirect, which is
 * true — but the email template still carries a **link**, because editing that template
 * requires custom SMTP on the free tier. With no `emailRedirectTo`, Supabase falls back to
 * the project's Site URL, so the link landed on `/` carrying a `?code=` nobody handled.
 *
 * The rule: as long as the template can send a link, this must name where a link should
 * land, regardless of what we would prefer it to send.
 */
async function origin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  // The request's own host, so a dev server on any port and a preview deployment on a URL
  // nobody configured each round-trip to themselves rather than to production.
  if (host) return `${h.get('x-forwarded-proto') ?? 'https'}://${host}`
  return process.env.APP_URL ?? 'http://localhost:3000'
}

export async function sendCode(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase()
  if (!EMAIL.test(email)) {
    return {
      kind: 'error',
      message: 'Enter an email address, including the @ and a domain.',
      email,
    }
  }

  const supabase = await supabaseServer()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await origin()}/auth/confirm` },
  })

  if (error) {
    const message = explain(error.message, error.status)
    // A failed resend must not retract a code that really was sent. Stay on the sent
    // screen — the address is still the useful thing on it — and say what just failed.
    if (prev.kind === 'sent' && prev.email === email) {
      return { kind: 'sent', email, notice: message }
    }
    return { kind: 'error', message, email }
  }

  return { kind: 'sent', email }
}

/**
 * Exchange the typed code for a session.
 *
 * Server-side on purpose: `verifyOtp` here writes the session cookie through the same
 * client the Server Components read, so the very next navigation is already signed in.
 * Doing it in the browser would leave the server a request behind.
 */
export async function verifyCode(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase()
  // Digits only, but no fixed length: Supabase's own code is six digits in the email
  // template and eight from the Admin API, so pinning it to six rejects a valid code.
  // Length is Supabase's business to enforce, not ours to guess.
  const token = String(form.get('code') ?? '').replace(/\D/g, '')

  if (token.length < 6) {
    return { kind: 'sent', email, notice: 'That code looks too short. Check it and try again.' }
  }

  const supabase = await supabaseServer()
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })

  if (error) {
    const m = error.message.toLowerCase()
    return {
      kind: 'sent',
      email,
      notice: m.includes('expired')
        ? 'That code has expired. Ask for a new one.'
        : 'That code was not accepted. Check the digits, or ask for a new one.',
    }
  }

  // Outside the try/catch shape above on purpose: `redirect` works by throwing, so it must
  // not sit anywhere an error branch could swallow it.
  redirect('/console')
}
