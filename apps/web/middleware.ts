import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/** Routes that require a session. Everything else is public by default. */
const PROTECTED = ['/console', '/account']

/**
 * Refreshes the Supabase session cookie on every matched request, and turns an expired or
 * absent session into a redirect before a protected page renders.
 *
 * Without the refresh, a Server Component reading the session gets a token that expired
 * mid-visit and the user is silently signed out. The refreshed cookie has to be written on
 * the response that is actually returned, which is why the response object is created up
 * front and threaded through `setAll` rather than built at the end.
 */
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // Unconfigured is not the same as unauthenticated. Redirecting to /login here would
  // send a misconfigured deployment into a loop that looks like a bad password.
  if (!url || !key) return res

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value)
        res = NextResponse.next({ request: req })
        for (const { name, value, options } of list) res.cookies.set(name, value, options)
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = req.nextUrl.pathname
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const to = req.nextUrl.clone()
    to.pathname = '/login'
    // Come back to where they were aiming once they are in.
    to.searchParams.set('next', path)
    return NextResponse.redirect(to)
  }

  return res
}

export const config = {
  /**
   * Everything except static assets and images.
   *
   * `/p/[id]` is intentionally inside this matcher but not in PROTECTED: approval pages
   * stay public capability URLs — approval happens out of band, on a phone, and requiring
   * a login there would break the flow the product is built around.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
