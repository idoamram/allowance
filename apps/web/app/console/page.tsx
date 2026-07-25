import { db } from '@/lib/db'
import { usd } from '@/lib/format'
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

/**
 * The operator's view: every plan this control plane has ever been asked to approve.
 *
 * Approval keys are never selected here — the console tells you a plan exists and what
 * it costs; it does not hand out the authority to approve it. The claimed-vs-settled diff
 * below reads the chain instead, so none of this table has to be taken on trust; T11 adds
 * receipts.
 */
export default async function ConsolePage() {
  const { data } = await db()
    .from('plans')
    .select('id, goal, status, total_usd, ceiling_usd, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  const plans = (data ?? []) as PlanRow[]

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Console</h1>
      <p className={styles.sub}>Every plan submitted, and what each one was allowed to cost.</p>

      {plans.length === 0 ? (
        <p className={styles.empty}>
          No plans yet. An agent creates one with <code>submit_plan</code>; it appears here the
          moment it is submitted, long before anyone approves it.
        </p>
      ) : (
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
              <tr key={plan.id}>
                <td>
                  <span className={styles.id}>{plan.id}</span>
                  <span className={styles.goal}>{plan.goal}</span>
                </td>
                <td>
                  <span className={`${styles.status} ${STATUS_CLASS[plan.status] ?? ''}`}>
                    {plan.status.replace('_', ' ')}
                  </span>
                </td>
                <td className={styles.num}>{usd(Number(plan.total_usd))}</td>
                <td className={styles.num}>{usd(Number(plan.ceiling_usd))}</td>
                <td className={styles.when}>
                  {new Date(plan.created_at).toISOString().replace('T', ' ').slice(0, 16)} UTC
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ClaimedVsSettled />

      <p className={styles.note}>
        This console is not yet behind a login &mdash; magic-link auth lands with the operator
        surface. Do not deploy it to a public URL with real plans in the table until it is.
      </p>
    </main>
  )
}
