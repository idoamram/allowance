'use client'

import { useActionState } from 'react'
import { sendMagicLink, type LoginState } from './actions'
import styles from './login.module.css'

/**
 * One state, one branch. `state.kind` decides the whole screen, so there is no arrangement
 * of flags that can render "a link is on its way" next to "the link could not be sent".
 */
export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {
    kind: 'idle',
  })

  if (state.kind === 'sent') {
    return (
      <div className={styles.sent} role="status">
        <span className={styles.stamp}>link sent</span>
        <h1 className={styles.title}>Check your email</h1>
        <p className={styles.sub}>
          A sign-in link is on its way to <span className={styles.address}>{state.email}</span>.
          Open it on this device and you land straight in the console. It is good for one use.
        </p>

        {state.notice && (
          <p className={styles.error} role="alert">
            {state.notice} The link already sent is still good.
          </p>
        )}

        <form action={action}>
          <input type="hidden" name="email" value={state.email} />
          <button type="submit" className={`${styles.btn} ${styles.ghost}`} disabled={pending}>
            {pending ? 'Sending…' : 'Send it again'}
          </button>
        </form>

        <p className={styles.note}>
          Sign-in links are rate limited to a few an hour. If one is already on its way, wait
          for it rather than asking for another &mdash; check spam first, then confirm the
          address above is the one you meant.
        </p>
      </div>
    )
  }

  return (
    <form action={action}>
      <h1 className={styles.title}>Sign in</h1>
      <p className={styles.sub}>
        We email you a link &mdash; no password to lose. Your account owns the agents that ask
        you to approve spending.
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
        defaultValue={state.kind === 'error' ? state.email : ''}
        placeholder="you@example.com"
      />

      <button type="submit" className={styles.btn} disabled={pending}>
        {pending ? 'Sending…' : 'Send me a link'}
      </button>

      {state.kind === 'error' && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}
    </form>
  )
}
