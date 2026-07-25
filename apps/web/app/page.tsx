export default function Home() {
  return (
    <main style={{ maxWidth: '42rem', margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1 style={{ fontSize: '2rem', margin: 0 }}>PlanBound</h1>
      <p style={{ color: 'var(--ink-soft)' }}>Your agent asks for a plan, not a payment.</p>
      <p>
        Approval pages live at <code>/p/[id]</code>; the operator console at{' '}
        <a href="/console">/console</a>.
      </p>
    </main>
  )
}
