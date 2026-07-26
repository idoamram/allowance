import Link from 'next/link'
import { usd } from '@/lib/format'
import { requireUser, supabaseServer } from '@/lib/supabase/server'
import ClaimedVsSettled from './claimed-vs-settled'
import styles from './console.module.css'

export const dynamic = 'force-dynamic'

type PlanRow = {
  id: string
  goal: string
  status: string
  total_usd: number | string
  ceiling_usd: number | string
  created_at: string
}

const STATUS_CLASS: Record<string, string> = {
  pending_approval: styles.statusOpen,
  approved: styles.statusGood,
  executing: styles.statusGood,
  settled: styles.statusGood,
  rejected: styles.statusStop,
  blocked: styles.statusStop,
  aborted: styles.statusStop,
}

/** Two states are a job for the human; the row says so at its edge, before it is read. */
const ROW_CLASS: Record<string, string> = {
  pending_approval: styles.rowWants,
  blocked: styles.rowStop,
}

/**
 * The operator's view: every plan submitted by an agent this human owns.
 *
 * Read through the cookie-bound client rather than the service-role one, so the row
 * filtering is the RLS policy from migration 0004 and not a `where` clause somebody has to
 * remember to write. Getting this query wrong now returns nothing; getting it wrong under
 * the service-role client would have returned everyone's plans.
 *
 * Approval keys are never selected here — the console tells you a plan exists and what it
 * costs; it does not hand out the authority to approve it. The claimed-vs-settled diff
 * below reads the chain instead, so none of this table has to be taken on trust.
 */
export default async function ConsolePage() {
  const user = await requireUser()
  const supabase = await supabaseServer()

  const { data } = await supabase
    .from('plans')
    .select('id, goal, status, total_usd, ceiling_usd, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  const plans = (data ?? []) as PlanRow[]

  // Summary before detail. Counted off the rows already in hand — no second query, and
  // no derived money figure, because a total that quietly mixes committed with quoted
  // would be the one number on this page nobody could check.
  const count = (...statuses: string[]) =>
    plans.filter((p) => statuses.includes(p.status)).length
  const tiles = [
    { label: 'Awaiting you', n: count('pending_approval'), tone: styles.tileWants },
    { label: 'Blocked on drift', n: count('blocked'), tone: styles.tileStop },
    { label: 'Running', n: count('approved', 'executing'), tone: '' },
    { label: 'Finished', n: count('settled', 'rejected', 'aborted'), tone: '' },
  ]

  return (
    <main className={styles.page}>
      <header>
        <p className={styles.brand}>PlanBound</p>
        <h1 className={styles.title}>Console</h1>
        <p className={styles.sub}>
          Every plan your agents submitted, and what each one was allowed to cost.
        </p>
      </header>

      {plans.length === 0 ? (
        <section className={`${styles.block} ${styles.section}`}>
          <p className={styles.eyebrow}>Plans</p>
          <p className={styles.empty}>
            No plans yet. Create an agent on <Link href="/account">your account page</Link>, then
            have it call <code>submit_plan</code> — a plan appears here the moment it is
            submitted, long before anyone approves it.
          </p>
        </section>
      ) : (
        <>
          <section className={`${styles.block} ${styles.section}`}>
            <p className={styles.eyebrow}>At a glance</p>
            <div className={styles.summary}>
              {tiles.map((tile) => (
                <div
                  key={tile.label}
                  className={`${styles.tile} ${tile.n === 0 ? styles.tileIdle : tile.tone}`}
                >
                  <span className={styles.tileLabel}>{tile.label}</span>
                  <span className={styles.tileFigure}>{tile.n}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={`${styles.block} ${styles.section}`}>
            <p className={styles.eyebrow}>Plans</p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Status</th>
                  <th className={styles.num}>Total</th>
                  <th className={styles.num}>Ceiling</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id} className={ROW_CLASS[plan.status] ?? ''}>
                    <td>
                      <span className={styles.id}>{plan.id}</span>
                      <span className={styles.goal}>{plan.goal}</span>
                    </td>
                    <td className={styles.cellStatus}>
                      <span className={`${styles.status} ${STATUS_CLASS[plan.status] ?? ''}`}>
                        {plan.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className={`${styles.num} ${styles.cellMoney}`} data-label="Total">
                      {usd(Number(plan.total_usd))}
                    </td>
                    <td className={`${styles.num} ${styles.cellMoney}`} data-label="Ceiling">
                      {usd(Number(plan.ceiling_usd))}
                    </td>
                    <td className={styles.when}>
                      {new Date(plan.created_at).toISOString().replace('T', ' ').slice(0, 16)} UTC
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <ClaimedVsSettled />

      <p className={styles.note}>
        Signed in as {user.email} &mdash; this table shows only plans submitted by agents you
        own. <Link href="/account">Manage agents and tokens</Link>.
      </p>
    </main>
  )
}
