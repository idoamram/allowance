import type { Metadata } from 'next'
import { THEME_SCRIPT } from './(components)/theme'
import './globals.css'

export const metadata: Metadata = {
  title: 'PlanBound',
  description: 'Your agent asks for a plan, not a payment.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` covers exactly one attribute: the script below stamps
    // `data-theme` on this element before React ever sees the document, so the server's
    // markup and the client's differ by design. It does not extend to any child.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking, in the head, ahead of the first byte of the body — the only place a
            theme choice can be applied without the reader watching the wrong one repaint.
            There is no Content-Security-Policy on this deployment today; if one is added,
            this needs the sha256 of THEME_SCRIPT in `script-src`, or a nonce here. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
