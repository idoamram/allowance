'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './agents.module.css'

/** Everything inside the panel that can take focus, in document order. */
const FOCUSABLE = 'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'

/**
 * The one moment this token is readable.
 *
 * Shaped as a counterfoil — the numbered stub torn off a document and kept — because that
 * is what it is: the record of an issue that happened once. It is deliberately not a
 * success dialog, and closing it is the irreversible act, so the way out is a line the
 * reader has to tick.
 *
 * Layout is three parts on purpose: a torn edge, a scrolling middle, and a pinned foot.
 * The foot holds the only control that dismisses the panel, so it stays on screen at any
 * height — a landscape phone is 390px tall, and a dismiss control that scrolls off there
 * is the same bug as no dismiss control at all.
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
  const panelRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const envLine = `PLANBOUND_AGENT_TOKEN=${token}`

  // Move the reader into the panel instead of leaving focus on the button behind it, so a
  // screen reader reaches the warning before it reaches the token — and hand focus back to
  // wherever it came from once the panel is gone.
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    headingRef.current?.focus()
    return () => returnTo?.focus?.()
  }, [])

  // Escape does not close this. Everywhere else that would be hostile; here the panel holds
  // a value that a reflex keystroke would destroy, so dismissal is the deliberate act only.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (e.key !== 'Tab') return
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    // Tab out of either end wraps back inside: while this is open it is the whole page.
    if (e.shiftKey && (active === first || active === headingRef.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
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
      <div
        ref={panelRef}
        className={styles.reveal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reveal-title"
        onKeyDown={onKeyDown}
      >
        <div className={styles.tear} aria-hidden="true" />

        <div className={styles.revealScroll}>
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
            Set it as <code>PLANBOUND_AGENT_TOKEN</code> in the agent&rsquo;s environment. It
            says which agent is asking. It holds no funds, and it cannot approve a plan.
          </p>
        </div>

        <div className={styles.revealFoot}>
          <label className={styles.revealAck}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I&rsquo;ve saved the token somewhere I can reach it.</span>
          </label>
          <button type="button" className={styles.doneBtn} disabled={!saved} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
