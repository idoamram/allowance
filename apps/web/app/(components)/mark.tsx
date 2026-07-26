/**
 * The PlanBound mark.
 *
 * A closed boundary with its bottom-right corner detached and set outside it: the envelope
 * holds exactly the approved ceiling, and the remainder returns.
 *
 * Inlined rather than fetched from `/icon.svg` because it is drawn in `currentColor` and has
 * to invert with the theme, which an `<img>` cannot do. Shared from here so a third copy is
 * never made — the geometry has one deliberate constraint (the 2-unit gap, which is what
 * survives a 16px favicon) and a hand-copied variant would quietly lose it.
 */
export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <g fill="currentColor">
        <rect x="0" y="0" width="20" height="4" />
        <rect x="0" y="4" width="4" height="16" />
        <rect x="4" y="16" width="10" height="4" />
        <rect x="16" y="4" width="4" height="10" />
        <rect x="16" y="16" width="4" height="4" />
      </g>
    </svg>
  )
}
