import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PlanBound',
  description: 'Your agent asks for a plan, not a payment.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
