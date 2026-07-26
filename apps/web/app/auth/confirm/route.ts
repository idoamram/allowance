import { NextResponse, type NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

/**
 * Where the magic link lands. Exchanges the one-time token in the URL for a session
 * cookie, then sends the human on to wherever they were originally headed.
 *
 * The token is single-use and short-lived, so a link that has already been opened — or
 * that a mail client prefetched — fails here rather than at the page. That failure is
 * reported as a reason on `/login`, not as a stack trace, because "the link expired" and
 * "the link is wrong" need different responses from the human.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  // Only ever a same-origin path. An absolute URL here would make this an open redirect.
  const rawNext = searchParams.get('next') ?? '/console'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/console'

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`)

  if (!token_hash || !type) return fail('That link was incomplete. Ask for a new one.')

  const supabase = await supabaseServer()
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
