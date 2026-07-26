/**
 * The theme choice, and the one line of script that applies it before first paint.
 *
 * Three states, not two. "System" is a real selection the reader can come back to, and it
 * is the absence of `data-theme` on the document element — which is exactly what makes the
 * `@media (prefers-color-scheme: dark)` block in globals.css the fallback rather than a
 * thing to fight. An explicit choice outranks it on specificity, in both directions.
 *
 * Shared on purpose: the landing page's masthead and the signed-in nav mount the same
 * control and read the same key, so a reader who picks dark on one lands in dark on the
 * other. Anything route-specific here would break that the first time it diverged.
 */

export type ThemeChoice = 'system' | 'light' | 'dark'

/** Namespaced because localStorage is shared with anything else ever served from this origin. */
export const THEME_KEY = 'planbound-theme'

/**
 * Runs blocking in `<head>`, before the body exists.
 *
 * This is the one piece of inline script in the product, and it has to be inline and
 * blocking: applied from a `useEffect` it would run *after* first paint, which is precisely
 * the flash of the wrong theme it exists to prevent. Kept to a single statement so that if
 * a Content-Security-Policy is ever added it can be hashed rather than nonce-plumbed —
 * `sha256` of this exact string, from this one constant.
 *
 * Wrapped in try/catch because Safari in private browsing throws on `localStorage` rather
 * than returning null, and a throw here would take the whole document down before paint.
 */
export const THEME_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});` +
  `if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

/** Applies a choice to the live document. `system` clears the stamp and lets the media query win. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'system') delete root.dataset.theme
  else root.dataset.theme = choice
}

/** What is stored right now, defaulting to the state that means "follow the device". */
export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}
