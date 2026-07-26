import type { Metadata } from 'next'
import Link from 'next/link'
import { requireUser } from '@/lib/supabase/server'
import { listAgents } from '@/lib/accounts'
import { AgentsPanel } from './agents-panel'
import { signOutAction } from './actions'
import styles from './account.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Account · PlanBound',
  robots: { index: false, follow: false },
}

export default async function AccountPage() {
  const user = await requireUser()
  const agents = await listAgents(user.id)

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div>
          <p className={styles.mark}>PlanBound</p>
          <h1 className={styles.title}>Account</h1>
          <p className={styles.email}>{user.email}</p>
        </div>
        <form action={signOutAction}>
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </header>

      <p className={styles.sub}>
        An agent belongs to you and holds one bearer token. The token proves which agent is
        asking &mdash; it never carries funds, and it cannot approve anything on your behalf.
      </p>

      <AgentsPanel agents={agents} />

      <p className={styles.footer}>
        <Link href="/console">Console</Link> &middot; every plan your agents have submitted.
      </p>
    </main>
  )
}
