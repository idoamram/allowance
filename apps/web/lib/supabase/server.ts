import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface SessionUser {
  id: string
  email: string
}

/**
 * The cookie-bound client, running as the `authenticated` role.
 *
 * This is deliberately not `db()`. `db()` holds the service-role key and bypasses RLS
 * entirely, which is correct for the agent API and the approval capability — both
 * authenticate before they reach Postgres. A browser session authenticates *in* Postgres,
 * so it gets the anon key and the ownership policies from migration 0004 decide what it
 * can see. The scoping is therefore enforced by the database, not by remembering to write
 * the right `where` clause in every query.
 */
export async function supabaseServer(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.example)',
    )
  }

  const store = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options)
        } catch {
          // Called from a Server Component, where the cookie store is read-only. The
          // middleware refreshes the session on every request, so dropping the write
          // here is safe rather than merely tolerable.
        }
      },
    },
  })
}

/**
 * The signed-in user, or null.
 *
 * Uses `getUser()`, never `getSession()`: `getSession()` returns whatever the cookie
 * claims, and the cookie is attacker-supplied. `getUser()` revalidates against the auth
 * server, which is the difference between a session and an assertion about one.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return null
  return { id: user.id, email: user.email }
}

/** The signed-in user, or a redirect to the login page. For pages that require an account. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser()
  if (!user) redirect('/login')
  return user
}
