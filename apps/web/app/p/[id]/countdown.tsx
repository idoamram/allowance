'use client'

import { useEffect, useState } from 'react'

/**
 * How long the human has, in the masthead where they look first.
 *
 * The authority to spend dies on a clock, so the page says so out loud and keeps saying it.
 * It used to be a static `expires 01:54 UTC` at the top with the live state three sections
 * down inside the envelope block — so a plan could be dead while the first thing anyone read
 * was a timestamp they had to compare against their own watch.
 *
 * It owns its tone as well as its text, because both change at the same instant. Styling it
 * from a server-computed `isExpired` would leave a page that has been open across the
 * boundary reading "Expired" in the colour of a live plan.
 *
 * Renders nothing on the server: "now" differs between the two, and a countdown that hydrates
 * with a mismatch is worse than one that appears a frame late.
 */
export function Countdown({
  expiresAt,
  className,
  liveClassName,
  expiredClassName,
}: {
  expiresAt: string
  /** Base class, always applied. */
  className?: string
  liveClassName?: string
  expiredClassName?: string
}) {
  const target = new Date(expiresAt).getTime()
  const [msLeft, setMsLeft] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => setMsLeft(target - Date.now())
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [target])

  if (msLeft === null) return null

  const classes = [className, msLeft <= 0 ? expiredClassName : liveClassName]
    .filter(Boolean)
    .join(' ')

  if (msLeft <= 0) {
    return (
      <span className={classes} role="status">
        Expired
      </span>
    )
  }

  const s = Math.floor(msLeft / 1000)
  // Minutes and seconds under an hour: the last minute is the one that matters, and
  // "0h 00m" would sit there looking static while it ran out.
  const parts =
    s >= 3600
      ? `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m left`
      : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s left`

  return (
    <span className={classes} role="timer">
      {parts}
    </span>
  )
}
