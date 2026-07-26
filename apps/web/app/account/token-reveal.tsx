'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './account.module.css'

/**
 * The one moment this token is readable.
 *
 * Shaped as a counterfoil — the numbered stub torn off a document and kept — because that
 * is what it is: the record of an issue that happened once. It is deliberately not a
 * success dialog. Escape and a stray click do not close it, and the way out is a line the
 * reader has to tick, because closing it is the irreversible act.
 */
export function TokenReveal({
  token,
  agentName,
  kind,
  onClose,
}: {
  token: string
  agentName: string
  /** Names the action that issued it, so the panel finishes the sentence the button started. */
  kind: 'created' | 'rotated'
  onClose: () => void
}) {
  const [copied, setCopied] = useState<'token' | 'env' | null>(null)
  const [manual, setManual] = useState(false)
  const [saved, setSaved] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const envLine = `PLANBOUND_AGENT_TOKEN=${token}`

  // Move the reader into the panel instead of leaving focus on the button behind it, so a
  // screen reader reaches the warning before it reaches the token.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  async function copy(text: string, which: 'token' | 'env') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setManual(false)
    } catch {
      // Insecure origins and locked-down browsers refuse the clipboard. Hand the job back
      // rather than leave a button that silently does nothing.
      setManual(true)
      setCopied(null)
    }
  }

  return (
    <div className={styles.revealBackdrop} role="presentation">
      <div className={styles.reveal} role="dialog" aria-modal="true" aria-labelledby="reveal-title">
        <div className={styles.tear} aria-hidden="true" />

        <p className={styles.counterfoil}>
          <span className={styles.counterfoilAction}>
            {kind === 'created' ? 'Agent created' : 'Token rotated'}
          </span>
          <span className={styles.counterfoilName}>{agentName}</span>
        </p>

        <h2 id="reveal-title" ref={headingRef} tabIndex={-1} className={styles.revealTitle}>
          This token is readable once.
        </h2>
        <p className={styles.revealBody}>
          PlanBound stores a hash of it, never the token itself, so this panel is the only
          place it appears. Close it and the value is unrecoverable &mdash; the only way to
          hold a readable token again is to rotate, which issues a different one and retires
          this.
        </p>

        <p className={styles.revealLabel}>Token</p>
        <output className={styles.tokenBox}>{token}</output>

        <button type="button" className={styles.copyBtn} onClick={() => copy(token, 'token')}>
          {copied === 'token' ? 'Copied' : 'Copy token'}
        </button>
        <button
          type="button"
          className={`${styles.copyBtn} ${styles.copyGhost}`}
          onClick={() => copy(envLine, 'env')}
        >
          {copied === 'env' ? 'Copied' : 'Copy as PLANBOUND_AGENT_TOKEN=…'}
        </button>

        {manual && (
          <p className={styles.revealManual} role="alert">
            This browser blocked the clipboard. Select the token above and copy it by hand.
          </p>
        )}

        <p className={styles.revealWhere}>
          Set it as <code>PLANBOUND_AGENT_TOKEN</code> in the agent&rsquo;s environment. It says
          which agent is asking. It holds no funds, and it cannot approve a plan.
        </p>

        <label className={styles.revealAck}>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>I&rsquo;ve saved the token somewhere I can reach it.</span>
        </label>

        <button type="button" className={styles.doneBtn} disabled={!saved} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
