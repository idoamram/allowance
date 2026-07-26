'use server'

import { headers } from 'next/headers'
import { supabaseServer } from '@/lib/supabase/server'

/**
 * What the login form knows after a submit. `sent` is the only success — there is no
 * signed-in state to return, because the session only exists after the emailed link is
 * opened and `/auth/confirm` exchanges it.
 */
export type LoginState = {
  sent?: boolean
  /** Echoed back so the "check your email" state can name the address it went to. */
  email?: string
  error?: string
}

/** Enough to reject a typo before spending one of Supabase's rate-limited sends. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Where the emailed link comes back to. The request's own host is preferred over
 * `APP_URL` so a dev server on any port, and a Vercel preview deployment on a URL
 * nobody configured, both round-trip to themselves rather than to production.
 */
async function origin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (host) return `${h.get('x-forwarded-proto') ?? 'http'}://${host}`
  return process.env.APP_URL ?? 'http://localhost:3000'
}

/**
 * Supabase's failures here are all things the human can act on — a wrong address, or
 * too many sends in a row. A generic "something went wrong" would leave them retrying
 * the one thing guaranteed not to work, so each is translated into its own sentence.
 */
function explain(message: string, status?: number): string {
  const m = message.toLowerCase()
  if (status === 429 || m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes')) {
    return 'Too many links requested. Supabase limits how often it will send — wait a minute and try again.'
  }
  if (m.includes('invalid') && m.includes('email')) {
    return 'That address was rejected as invalid. Check it for a typo.'
  }
  if (m.includes('signups not allowed') || m.includes('not allowed for this instance')) {
    return 'This address is not allowed to sign in to this deployment.'
  }
  return `Supabase could not send the link: ${message}`
}

export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  if (!EMAIL.test(email)) {
    return { error: 'Enter an email address — that one is missing an @ or a domain.', email }
  }

  const supabase = await supabaseServer()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await origin()}/auth/confirm` },
  })

  if (error) return { error: explain(error.message, error.status), email }
  return { sent: true, email }
}
