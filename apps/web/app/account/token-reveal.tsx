'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './account.module.css'

/**
 * The one moment this token exists in readable form.
 *
 * Designed against a hurried person: it takes the whole screen, it cannot be dismissed by
 * Escape or by clicking away, and the way out is a checkbox that says out loud what closing
 * costs. Everything else on the page can wait; this cannot be reopened.
 */
export function TokenReveal({
  token,
  agentName,
  onDone,
}: {
  token: string
  agentName: string
  onDone: () => void
}) {
  const [copied, setCopied] = useState<'token' | 'env' | null>(null)
  const [manual, setManual] = useState(false)
  const [ack, setAck] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const envLine = `PLANBOUND_AGENT_TOKEN=${token}`

  // Move the reader into the panel rather than leaving focus behind on the button that
  // opened it — a screen-reader user should hear the warning, not discover it later.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  async function copy(text: string, which: 'token' | 'env') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setManual(false)
    } catch {
      // Insecure contexts and locked-down browsers refuse the clipboard. Say so and
      // hand the job back to the human rather than silently doing nothing.
      setManual(true)
      setCopied(null)
    }
  }

  return (
    <div className={styles.revealBackdrop} role="presentation">
      <div className={styles.reveal} role="dialog" aria-modal="true" aria-labelledby="reveal-title">
        <p className={styles.revealOnce}>shown once</p>
        <h2 id="reveal-title" ref={headingRef} tabIndex={-1} className={styles.revealTitle}>
          Copy this token now
        </h2>
        <p className={styles.revealBody}>
          This is the only time <b>{agentName}</b>&rsquo;s token is readable. We store a hash of
          it, not the token &mdash; so if you close this panel without copying it, nobody can
          recover it. You would have to rotate and start again.
        </p>

        <p className={styles.revealLabel}>Token</p>
        <output className={styles.tokenBox}>{token}</output>

        <button type="button" className={styles.copyBtn} onClick={() => copy(token, 'token')}>
          {copied === 'token' ? 'Copied ✓' : 'Copy token'}
        </button>
        <button
          type="button"
          className={`${styles.copyBtn} ${styles.copyGhost}`}
          onClick={() => copy(envLine, 'env')}
        >
          {copied === 'env' ? 'Copied ✓' : 'Copy as PLANBOUND_AGENT_TOKEN=…'}
        </button>

        {manual && (
          <p className={styles.revealManual} role="alert">
            This browser blocked the clipboard. Select the token above and copy it by hand.
          </p>
        )}

        <p className={styles.revealWhere}>
          It goes in the agent&rsquo;s environment as <code>PLANBOUND_AGENT_TOKEN</code>. That is
          the whole credential &mdash; it authenticates the agent, and it funds nothing on its
          own.
        </p>

        <label className={styles.revealAck}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I have stored it. I understand it will never be shown again.</span>
        </label>

        <button
          type="button"
          className={styles.doneBtn}
          disabled={!ack}
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </div>
  )
}
