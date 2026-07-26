'use client'

import { useEffect, useState } from 'react'
import { applyTheme, readTheme, THEME_KEY, type ThemeChoice } from './theme'
import styles from './theme-toggle.module.css'

const OPTIONS: { value: ThemeChoice; label: string; title: string }[] = [
  { value: 'system', label: 'Auto', title: 'Follow this device' },
  { value: 'light', label: 'Light', title: 'Always light' },
  { value: 'dark', label: 'Dark', title: 'Always dark' },
]

/**
 * Three states, shown as three states.
 *
 * A two-way switch cannot express "follow the device", and a control that silently cycles
 * gives the reader no way to know what they are about to get. All three options are on
 * screen, the current one is marked in form as well as by `aria-pressed`, and each is its
 * own tab stop.
 *
 * The stored choice is read after mount rather than during render: the page itself is
 * already correct by then — the blocking script in `<head>` stamped it before first paint —
 * so the only thing settling here is which of the three reads as selected, and a server/
 * client mismatch on that would be a hydration error for no gain.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>('system')

  useEffect(() => {
    setChoice(readTheme())
  }, [])

  function pick(next: ThemeChoice) {
    setChoice(next)
    applyTheme(next)
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, next)
    } catch {
      // Storage refused — the choice still holds for this page, it just will not carry
      // to the next one. Better than a control that throws under the reader's finger.
    }
  }

  return (
    <div className={styles.group} role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.option}
          aria-pressed={choice === option.value}
          title={option.title}
          onClick={() => pick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
