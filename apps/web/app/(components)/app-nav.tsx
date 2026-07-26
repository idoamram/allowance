import Link from 'next/link'
import { signOutAction } from '@/app/console/actions'
import { ThemeToggle } from './theme-toggle'
import { Mark } from './mark'
import styles from './app-nav.module.css'

/**
 * The signed-in app's one piece of chrome.
 *
 * It carries five things and nothing else: the mark, where you are, the way to everywhere
 * else, how the app is lit, and who you are signed in as with the way out. At 320px it
 * stays a single bar —
 * the identity drops to a second line rather than the links wrapping into a stack, because
 * a nav that reflows into a paragraph stops reading as a nav.
 *
 * Deliberately scoped to the signed-in surface rather than mounted in the root layout.
 * Two routes must never carry it:
 *
 *   /p/[id]      a capability URL, opened out of band by an approver who usually has no
 *                account here. App chrome would offer them links that dead-end at a login
 *                wall, and would blur the line the product rests on — the console shows a
 *                plan exists and what it costs; it never hands out authority to approve it.
 *   /oauth/consent  a grant decision. Navigation mid-grant loses people, and chrome around
 *                a consent prompt is the shape phishing takes.
 *
 * The landing page has its own masthead and /login has nowhere to go yet, so neither needs
 * this either. What is left is exactly the operator surface, which is where it mounts.
 *
 * The mark is inlined rather than fetched from /icon.svg: production runs a strict CSP and
 * a nav that waits on a network request is a nav that flashes empty on every load.
 */
export function AppNav({ email }: { email: string }) {
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        {/* The mark alone. The wordmark beside it said the same thing twice, and this
            bar is tight at 320px — the name is in the tab title and the page heading. */}
        <Link href="/console" className={styles.mark} aria-label="PlanBound console">
          <Mark className={styles.glyph} />
        </Link>

        <nav className={styles.links} aria-label="Console sections">
          <span className={styles.here} aria-current="page">
            Console
          </span>
          <a href="#plans">Plans</a>
          <a href="#agents">Agents</a>
          <a href="#chain">Chain</a>
          <Link href="/" className={styles.away}>
            Home
          </Link>
        </nav>

        <div className={styles.who}>
          <ThemeToggle />
          <span className={styles.email} title={email}>
            {email}
          </span>
          <form action={signOutAction}>
            <button type="submit" className={styles.signOut}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
