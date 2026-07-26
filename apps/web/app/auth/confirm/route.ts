import { NextResponse, type NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

/**
 * Where the magic link lands. Exchanges the one-time credential in the URL for a session
 * cookie, then sends the human on to wherever they were originally headed.
 *
 * Two shapes arrive here, and which one you get depends on the project's auth flow rather
 * than on anything we choose per request:
 *
 *   ?code=…                  PKCE. Supabase verifies the emailed token itself, then
 *                            redirects here with an authorization code to exchange. This
 *                            is what our project actually sends.
 *   ?token_hash=…&type=…     The older direct-verification shape, verified here.
 *
 * Both are handled because a project can be switched between them in the dashboard, and
 * the failure mode when only one is implemented is indistinguishable from a broken link:
 * the human clicks a perfectly good email and lands back on the sign-in page being told
 * their link was incomplete. It was not — we were.
 *
 * PKCE additionally needs the code verifier that `signInWithOtp` set as a cookie, so the
 * link must be opened in the same browser that asked for it. That is worth saying out
 * loud in the error, because "open it on your phone instead" is a thing people do.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  // Only ever a same-origin path. An absolute URL here would make this an open redirect.
  const rawNext = searchParams.get('next') ?? '/console'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/console'

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`)

  const supabase = await supabaseServer()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return fail(
        /verifier|code challenge/i.test(error.message)
          ? 'Open the link in the same browser you requested it from — that is where the sign-in started.'
          : 'That link has expired or was already used. Ask for a new one.',
      )
    }
    return NextResponse.redirect(`${origin}${next}`)
  }

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as 'magiclink' | 'email',
      token_hash,
    })
    if (error) {
      return fail(
        error.message.toLowerCase().includes('expired')
          ? 'That link has expired. Ask for a new one.'
          : 'That link is no longer valid — it may already have been used. Ask for a new one.',
      )
    }
    return NextResponse.redirect(`${origin}${next}`)
  }

  // Neither shape present: the link really is malformed, or it was truncated by a mail
  // client. Distinct from the cases above, which are all "valid link, wrong conditions".
  return fail('That link was incomplete. Ask for a new one.')
}
