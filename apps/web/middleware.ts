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

  const path = req.nextUrl.pathname

  /**
   * A sign-in credential that landed somewhere with no handler.
   *
   * Supabase decides where an emailed link goes: `emailRedirectTo` when we set one, the
   * project's Site URL when we do not. Both are configuration, and one of them is in a
   * dashboard nobody here can see from the code. When that lands a `?code=` on `/`, the
   * human has clicked a valid link, arrived at a page that ignores it, and been told
   * nothing — which is what happened.
   *
   * Forwarding it to the one route that knows how to exchange it makes the flow depend on
   * the credential arriving *somewhere* rather than on the dashboard agreeing with us.
   * `/auth/confirm` is excluded so this cannot loop.
   */
  const strayCode = req.nextUrl.searchParams.get('code')
  if (strayCode && !path.startsWith('/auth/')) {
    const to = req.nextUrl.clone()
    to.pathname = '/auth/confirm'
    if (path !== '/') to.searchParams.set('next', path)
    return NextResponse.redirect(to)
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
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
