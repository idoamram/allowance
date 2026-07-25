'use client'

import { useEffect, useState } from 'react'

/**
 * How long the human has. The authority to spend dies on time, so the page says so
 * out loud rather than leaving it to the timestamp in the header.
 *
 * Renders nothing on the server: "now" differs between the two, and a countdown that
 * hydrates with a mismatch is worse than one that appears a frame late.
 */
export function Countdown({ expiresAt }: { expiresAt: string }) {
  const target = new Date(expiresAt).getTime()
  const [msLeft, setMsLeft] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => setMsLeft(target - Date.now())
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [target])

  if (msLeft === null) return null
  if (msLeft <= 0) return <span>expired &mdash; nothing can be funded from this plan</span>

  const s = Math.floor(msLeft / 1000)
  const parts =
    s >= 3600
      ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
      : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`

  return <span>{parts} left to decide</span>
}
