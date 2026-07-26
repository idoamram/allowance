'use client'

import { useActionState } from 'react'
import { sendMagicLink, type LoginState } from './actions'
import styles from './login.module.css'

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {})

  if (state.sent) {
    return (
      <div className={styles.sent} role="status">
        <span className={styles.stamp}>link sent</span>
        <h1 className={styles.title}>Check your email</h1>
        <p className={styles.sub}>
          A sign-in link is on its way to <span className={styles.address}>{state.email}</span>.
          Open it on this device and you land straight in the console. It is good for one use.
        </p>
        <form action={action}>
          <input type="hidden" name="email" value={state.email ?? ''} />
          <button type="submit" className={`${styles.btn} ${styles.ghost}`} disabled={pending}>
            {pending ? 'Sending…' : 'Send it again'}
          </button>
        </form>
        {state.error && (
          <p className={styles.error} role="alert">
            {state.error}
          </p>
        )}
        <p className={styles.note}>
          Nothing arrived? Check spam, then confirm the address above is the one you meant.
        </p>
      </div>
    )
  }

  return (
    <form action={action}>
      <h1 className={styles.title}>Sign in</h1>
      <p className={styles.sub}>
        We email you a link — no password to lose. Your account owns the agents that ask you
        to approve spending.
      </p>

      <label className={styles.label} htmlFor="email">
        Email address
      </label>
      <input
        id="email"
        name="email"
        type="email"
        className={styles.input}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        defaultValue={state.email ?? ''}
        placeholder="you@example.com"
      />

      <button type="submit" className={styles.btn} disabled={pending}>
        {pending ? 'Sending…' : 'Send me a link'}
      </button>

      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
    </form>
  )
}
