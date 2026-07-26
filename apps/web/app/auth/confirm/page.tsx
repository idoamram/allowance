'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabase/client'

/**
 * Where every sign-in link lands, whichever shape it arrives in.
 *
 * Supabase emits three, and which one you get depends on project settings and on whether
 * the link was emailed or minted through the Admin API — not on anything we choose:
 *
 *   #access_token=…&refresh_token=…   implicit; tokens in the URL fragment
 *   ?code=…                           PKCE; an authorization code to exchange
 *   ?token_hash=…&type=…              direct verification
 *
 * This is a client component rather than a route handler because of the first one. A URL
 * fragment is never transmitted to the server — it is a browser-only construct — so a
 * server handler sees an empty query string and can only conclude the link was malformed.
 * That is exactly what it did, twice, on links that were perfectly valid.
 *
 * The browser client processes the fragment itself on construction (`detectSessionInUrl`),
 * so for that shape the work is done by the time we look; `getSession()` is how we find
 * out whether it worked. The other two are exchanged explicitly. All three end at the same
 * place: a session cookie the server can read on the next navigation.
 */
export default function AuthConfirmPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const fail = (reason: string) => {
      if (!cancelled) setError(reason)
    }

    const run = async () => {
      const supabase = supabaseBrowser()
      const params = new URLSearchParams(window.location.search)

      // Only ever a same-origin path — an absolute URL here would be an open redirect.
      const raw = params.get('next') ?? '/console'
      const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/console'

      // Supabase reports failures in the query string even for fragment-carrying links.
      const urlError = params.get('error_description') ?? params.get('error')
      if (urlError) return fail(urlError)

      const hash = new URLSearchParams(window.location.hash.slice(1))
      const code = params.get('code')
      const tokenHash = params.get('token_hash')
      const type = params.get('type')

      if (hash.get('access_token')) {
        // Already consumed by the client on construction; confirm rather than assume.
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !data.session) {
          return fail('That link could not be completed. Ask for a new one.')
        }
      } else if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) {
          return fail(
            /verifier|code challenge/i.test(exchangeError.message)
              ? 'Open the link in the same browser you requested it from — that is where the sign-in started.'
              : 'That link has expired or was already used. Ask for a new one.',
          )
        }
      } else if (tokenHash && type) {
        const { error: otpError } = await supabase.auth.verifyOtp({
          type: type as 'magiclink' | 'email',
          token_hash: tokenHash,
        })
        if (otpError) {
          return fail(
            otpError.message.toLowerCase().includes('expired')
              ? 'That link has expired. Ask for a new one.'
              : 'That link is no longer valid — it may already have been used. Ask for a new one.',
          )
        }
      } else {
        // Nothing in the query and nothing in the fragment: the link really is malformed,
        // or a mail client truncated it. The only case where "incomplete" is true.
        return fail('That link was incomplete. Ask for a new one.')
      }

      if (cancelled) return
      // Strip the credential out of the address bar before moving on, so it does not sit
      // in history or get pasted along with the URL.
      window.history.replaceState(null, '', window.location.pathname)
      router.replace(next)
      router.refresh()
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <main
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '60dvh',
        padding: '2rem 1.5rem',
        textAlign: 'center',
      }}
    >
      {error ? (
        <div>
          <p style={{ color: 'var(--stop)', margin: '0 0 1rem' }}>{error}</p>
          <a href="/login">Back to sign in</a>
        </div>
      ) : (
        <p style={{ color: 'var(--ink-soft)', margin: 0 }}>Signing you in…</p>
      )}
    </main>
  )
}
