import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client. Server-only by import — RLS is enabled with no policies, so
 * this is the only way in, and it must never reach a browser bundle.
 * Every identifier comes from env: a cloner points this at their own project.
 */
export function db() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example)')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}
