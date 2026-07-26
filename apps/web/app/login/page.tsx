import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { currentUser } from '@/lib/supabase/server'
import { LoginForm } from './login-form'
import styles from './login.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Sign in · PlanBound',
  robots: { index: false, follow: false },
}

export default async function LoginPage() {
  // Already signed in: the sign-in page has nothing to ask, so it doesn't ask it.
  if (await currentUser()) redirect('/console')

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.mark}>PlanBound</p>
        <LoginForm />
      </div>
      <p className={styles.footer}>
        Signing in only identifies you. It funds nothing &mdash; every envelope still needs
        its own approval.
      </p>
    </main>
  )
}
