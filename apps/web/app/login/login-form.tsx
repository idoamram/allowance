'use client'

import { useActionState, useState } from 'react'
import { sendCode, verifyCode, type LoginState } from './actions'
import styles from './login.module.css'

/**
 * One state, one branch. `state.kind` decides the whole screen, so there is no arrangement
 * of flags that can render "a code is on its way" next to "the code could not be sent".
 *
 * Two forms share the state because they are two steps of one act: the code step needs the
 * address the send step captured, and a resend has to land back in the same place.
 */
export function LoginForm() {
  const [state, send, sending] = useActionState<LoginState, FormData>(sendCode, { kind: 'idle' })
  const [verifyState, verify, verifying] = useActionState<LoginState, FormData>(verifyCode, {
    kind: 'idle',
  })
  const [hasCode, setHasCode] = useState(false)

  /**
   * Entering a code you already hold must not require sending another email.
   *
   * The first version only revealed the code field after a successful send, which put the
   * escape hatch behind the exact thing that fails: sends are rate limited to a few an
   * hour, and someone who has burned that allowance is precisely the person holding a code
   * and no way to use it.
   */
  if (hasCode && state.kind !== 'sent') {
    const notice = verifyState.kind === 'sent' ? verifyState.notice : undefined
    return (
      <form action={verify}>
        <h1 className={styles.title}>Enter your code</h1>
        <p className={styles.sub}>
          Type the address you asked for the code with, and the code itself. No new email is
          sent, so this works even when sending is rate limited.
        </p>

        <label className={styles.label} htmlFor="code-email">
          Email address
        </label>
        <input
          id="code-email"
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

        <label className={styles.label} htmlFor="code-only">
          Code
        </label>
        <input
          id="code-only"
          name="code"
          type="text"
          className={styles.input}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={10}
          required
          autoFocus
          placeholder="123456"
          style={{ letterSpacing: '0.4em', fontVariantNumeric: 'tabular-nums' }}
        />

        <button type="submit" className={styles.btn} disabled={verifying}>
          {verifying ? 'Checking…' : 'Sign in'}
        </button>

        {notice && (
          <p className={styles.error} role="alert">
            {notice}
          </p>
        )}

        <button
          type="button"
          className={`${styles.btn} ${styles.ghost}`}
          onClick={() => setHasCode(false)}
        >
          Back to email sign-in
        </button>
      </form>
    )
  }

  if (state.kind === 'sent') {
    // A verification failure carries its own notice; otherwise show the send's.
    const notice = verifyState.kind === 'sent' ? verifyState.notice : state.notice

    return (
      <div className={styles.sent}>
        <span className={styles.stamp}>sent</span>
        <h1 className={styles.title}>Check your email</h1>
        <p className={styles.sub}>
          We sent a sign-in email to <span className={styles.address}>{state.email}</span>. Open
          the link in it on this device and you land straight in the console.
        </p>

        <form action={verify}>
          <input type="hidden" name="email" value={state.email} />
          {/*
            The fallback, and it must read as one. This field used to carry autoFocus, so
            the cursor landed here and the screen read as "we sent you a code" while the
            email carried a link — Ido reported exactly that confusion. The link is the
            path; this is for when it does not work.
          */}
          <label className={styles.label} htmlFor="code">
            Link not working? Type the code instead
          </label>
          <input
            id="code"
            name="code"
            type="text"
            className={styles.input}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={10}
            placeholder="123456"
            style={{ letterSpacing: '0.4em', fontVariantNumeric: 'tabular-nums' }}
          />
          <button type="submit" className={`${styles.btn} ${styles.ghost}`} disabled={verifying}>
            {verifying ? 'Checking…' : 'Sign in with code'}
          </button>
        </form>

        {notice && (
          <p className={styles.error} role="alert">
            {notice}
          </p>
        )}

        <form action={send}>
          <input type="hidden" name="email" value={state.email} />
          <button type="submit" className={`${styles.btn} ${styles.ghost}`} disabled={sending}>
            {sending ? 'Sending…' : 'Send it again'}
          </button>
        </form>

        <p className={styles.note}>
          Sign-in emails are rate limited to a few an hour. If one is already on its way, wait
          for it rather than asking for another &mdash; check spam first, then confirm the
          address above is the one you meant.
        </p>
      </div>
    )
  }

  return (
    <form action={send}>
      <h1 className={styles.title}>Sign in</h1>
      <p className={styles.sub}>
        We email you a sign-in link &mdash; no password to lose. Your account owns the agents
        that ask you to approve spending.
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

      <button type="submit" className={styles.btn} disabled={sending}>
        {sending ? 'Sending…' : 'Send me a link'}
      </button>

      {state.kind === 'error' && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}

      <button
        type="button"
        className={`${styles.btn} ${styles.ghost}`}
        onClick={() => setHasCode(true)}
      >
        I already have a code
      </button>
    </form>
  )
}
