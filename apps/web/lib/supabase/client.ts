'use client'
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The browser-side client. Writes the same cookies the server client reads, so a session
 * established here is visible to Server Components on the next navigation.
 *
 * This exists for exactly one job: completing a sign-in whose credential arrives in the
 * URL *fragment*, which the server can never see.
 */
export function supabaseBrowser(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set')
  }
  return createBrowserClient(url, key)
}
