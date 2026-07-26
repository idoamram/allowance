#!/usr/bin/env tsx
/**
 * Print a sign-in code without sending an email.
 *
 *   pnpm signin:code you@example.com
 *
 * Supabase's built-in SMTP allows only a few messages an hour on the free tier — fine in
 * normal use, useless during a demo, where one wrong click locks sign-in out for the next
 * hour. The Admin API generates the same six-digit code the email would have carried, and
 * generating it does not send anything, so the rate limit never applies.
 *
 * Type the printed code into /login exactly as if it had arrived by email. Nothing about
 * the app changes; this only skips the mail server.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS and can mint a session for any
 * address in the project. That is why this is a local operator script and not a route:
 * there is no authorization here beyond possession of the key. Never expose it as an
 * endpoint.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: resolve(repoRoot, '.env.local'), quiet: true } as Parameters<typeof loadEnv>[0])

function fatal(message: string): never {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

const email = process.argv[2]?.trim()
if (!email) fatal('usage: pnpm signin:code <email>')

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) fatal('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })

if (error) {
  fatal(
    /not found|does not exist/i.test(error.message)
      ? `no user for ${email} yet — send one code through /login first, which creates the account`
      : `could not generate a code: ${error.message}`,
  )
}

const code = data.properties?.email_otp
if (!code) fatal('Supabase returned no email_otp — check that the Magic Link template uses {{ .Token }}')

console.log(`\n  Sign-in code for ${email}:   ${code}\n`)
console.log('  Type it into /login. One use, expires shortly. No email was sent.\n')
