import type { Metadata } from 'next'
import Link from 'next/link'
import { usd } from '@/lib/format'
import { listAgents } from '@/lib/accounts'
import { requireUser, supabaseServer } from '@/lib/supabase/server'
import ClaimedVsSettled from './claimed-vs-settled'
import { AgentsPanel } from './agents-panel'
import { HumanPanel } from './human-panel'
import { getBinding } from '@/lib/human-binding'
import styles from './console.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Console · PlanBound',
  robots: { index: false, follow: false },
}

type PlanRow = {
  id: string
  goal: string
  status: string
  total_usd: number | string
  ceiling_usd: number | string
  created_at: string
  expires_at: string
  approval_key: string
}

/** Every state a plan can be in, and what it means to the person reading the row. */
const STATUS: Record<string, { label: string; tone: 'wants' | 'live' | 'done' | 'stop' }> = {
  pending_approval: { label: 'Wants you', tone: 'wants' },
  blocked: { label: 'Blocked', tone: 'stop' },
  approved: { label: 'Approved', tone: 'live' },
  executing: { label: 'Executing', tone: 'live' },
  settled: { label: 'Settled', tone: 'done' },
  rejected: { label: 'Rejected', tone: 'done' },
  aborted: { label: 'Aborted', tone: 'done' },
  expired: { label: 'Expired', tone: 'done' },
}

const TONE_PILL = {
  wants: styles.pillWants,
  stop: styles.pillStop,
  live: styles.pillLive,
  done: styles.pillDone,
}

const TONE_ROW = { wants: styles.rowWants, stop: styles.rowStop, live: '', done: '' }

const stamp = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16)

/**
 * The operator surface — the whole signed-in app, on one route.
 *
 * It answers three questions in the order an operator asks them: what is waiting on me,
 * what did my agents spend, and does the chain agree with what we claim. The account that
 * used to be its own page is the fourth block, because "you own one agent and here is its
 * token" is three lines, not a destination.
 *
 * Read through the cookie-bound client rather than the service-role one, so the row
 * filtering is the RLS policy from migration 0004 and not a `where` clause somebody has to
 * remember to write. Getting this query wrong now returns nothing; getting it wrong under
 * the service-role client would have returned everyone's plans.
 *
 * `approval_key` is selected on purpose. It was withheld while this page had no
 * authentication and listed the whole control plane; behind a session, RLS guarantees the
 * reader is the human who owns the agent and whose approval funds the envelope, so
 * withholding their own key protected nobody and dead-ended them a minute after sign-in.
 * The capability URL is still the mechanism — this is one more place its owner can get it.
 */
export default async function ConsolePage() {
  const user = await requireUser()
  const supabase = await supabaseServer()

  const [{ data }, agents, binding] = await Promise.all([
    supabase
      .from('plans')
      .select('id, goal, status, total_usd, ceiling_usd, created_at, expires_at, approval_key')
      .order('created_at', { ascending: false })
      .limit(100),
    listAgents(user.id),
    getBinding(user.id),
  ])
  const rows = (data ?? []) as PlanRow[]

  /**
   * Expiry is derived, never read from `status`.
   *
   * A plan carries an `expires_at` and nothing sweeps the table when it passes — there is no
   * cron here, and the decision route only writes `expired` if somebody happens to answer a
   * dead plan. So a stored status of `pending_approval` means "nobody answered", which is not
   * the same as "still answerable", and reading it as the latter is what put four dead plans
   * under a heading that said they were waiting for this human.
   *
   * Deriving it costs one comparison and cannot drift. Writing it would need a job, and a job
   * that stops running fails silently in exactly this direction.
   */
  const now = Date.now()
  const isDead = (p: PlanRow) => new Date(p.expires_at).getTime() <= now
  const plans: PlanRow[] = rows.map((p) =>
    isDead(p) && (p.status === 'pending_approval' || p.status === 'blocked')
      ? { ...p, status: 'expired' }
      : p,
  )

  // Counted off the rows already in hand — no second query, and no summed money figure,
  // because a total that quietly mixes committed with quoted would be the one number on
  // this page nobody could check.
  const of = (...statuses: string[]) => plans.filter((p) => statuses.includes(p.status))
  const waiting = of('pending_approval')
  const blocked = of('blocked')
  const running = of('approved', 'executing')
  const finished = of('settled', 'rejected', 'aborted', 'expired')

  const link = (p: PlanRow) => `/p/${p.id}?k=${p.approval_key}`
  /**
   * Soonest to expire, not oldest.
   *
   * Oldest-first is ordinary queue discipline and it is wrong for this queue: these are
   * time-boxed approvals with differing windows, so the oldest is the likeliest to be already
   * dead — the CTA walked the human straight into one. Ordering by remaining time puts the
   * plan where delay actually costs something at the top, and a blocked plan outranks an
   * unanswered one because an agent is already stopped against it.
   */
  const next = [...blocked, ...waiting].sort(
    (a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime(),
  )[0]

  const ledger = [
    { label: 'Running', n: running.length },
    { label: 'Finished', n: finished.length },
    { label: 'Agents', n: agents.length },
  ]

  return (
    <main className={styles.page}>
      {/* ── what needs you, before anything else ─────────────────────────────
          Only when there is a body of work to summarise. With no plans at all
          the summary and the empty state would say the same sentence twice, so
          the invitation in the Plans section below carries it alone — and says
          it in the place the plans will appear. */}
      {plans.length > 0 && (
        <section className={styles.hero}>
          {blocked.length > 0 ? (
            <Headline
              figure={blocked.length}
              tone="stop"
              lead={`${blocked.length === 1 ? 'plan is' : 'plans are'} blocked on drift.`}
              body="A step asked more than it quoted, so the co-signer refused and the run stopped there. The diff shows what already settled and the price of each way out."
              cta={next ? { href: link(next), text: 'Open the drift diff' } : undefined}
            />
          ) : waiting.length > 0 ? (
            <Headline
              figure={waiting.length}
              tone="wants"
              lead={`${waiting.length === 1 ? 'plan is' : 'plans are'} waiting for your approval.`}
              body="Nothing runs until you approve, and approving is what funds the envelope. Until then the agent holds no money at all."
              cta={next ? { href: link(next), text: 'Review the most urgent' } : undefined}
            />
          ) : (
            <Headline
              figure={0}
              tone="clear"
              lead="plans are waiting on you."
              body="Every plan your agents submitted has been answered. A new one appears here the moment it is submitted, long before anyone approves it."
            />
          )}

          <dl className={styles.ledger}>
            {ledger.map((item) => (
              <div key={item.label} className={styles.ledgerItem}>
                <dt>{item.label}</dt>
                <dd>{item.n}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* ── the substance ────────────────────────────────────────────────── */}
      <section id="plans" className={styles.section}>
        <SectionHead
          title="Plans"
          count={plans.length > 0 ? plans.length : undefined}
          note={plans.length > 0 ? 'Newest first · quoted against the ceiling approved' : undefined}
        />

        {plans.length === 0 ? (
          <NoPlansYet hasAgent={agents.length > 0} />
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Plan</th>
                <th>State</th>
                <th className={styles.num}>Quoted</th>
                <th className={styles.num}>Ceiling</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => {
                const state = STATUS[plan.status] ?? { label: plan.status, tone: 'done' as const }
                const total = Number(plan.total_usd)
                const ceiling = Number(plan.ceiling_usd)
                const used = ceiling > 0 ? Math.min(100, (total / ceiling) * 100) : 0
                return (
                  <tr key={plan.id} className={TONE_ROW[state.tone]}>
                    <td className={styles.cellPlan}>
                      <Link href={link(plan)} className={styles.rowLink}>
                        {plan.goal}
                      </Link>
                      <span className={styles.id}>{plan.id}</span>
                    </td>
                    <td className={styles.cellState}>
                      <span className={`${styles.pill} ${TONE_PILL[state.tone]}`}>
                        {state.label}
                      </span>
                    </td>
                    <td className={`${styles.num} ${styles.cellMoney}`} data-label="Quoted">
                      {usd(total)}
                    </td>
                    <td className={`${styles.num} ${styles.cellMoney}`} data-label="Ceiling">
                      {usd(ceiling)}
                      {/* The product's whole idea, per row: how much of the approved
                          ceiling the quote uses, and therefore how much headroom is
                          left for drift. Both figures are already on the row. */}
                      <span
                        className={styles.meter}
                        title={`quote uses ${Math.round(used)}% of the ceiling`}
                      >
                        <span className={styles.meterFill} style={{ width: `${used}%` }} />
                      </span>
                    </td>
                    <td className={styles.when}>{stamp(plan.created_at)} UTC</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* ── who you are and what you own ─────────────────────────────────── */}
      <section id="agents" className={styles.section}>
        <SectionHead
          title="Agents and tokens"
          count={agents.length > 0 ? agents.length : undefined}
          note="One token each, shown once when it is issued"
        />
        <AgentsPanel agents={agents} />

        <HumanPanel binding={binding} />
      </section>

      {/* ── and whether to believe any of it ─────────────────────────────── */}
      <section id="chain" className={styles.section}>
        <ClaimedVsSettled />
      </section>

      <p className={styles.foot}>
        Signed in as {user.email} — this page shows only what agents you own submitted.
      </p>
    </main>
  )
}

/** The one thing on the page set at display size: what the operator has to do next. */
function Headline({
  figure,
  tone,
  lead,
  body,
  cta,
}: {
  figure?: number
  tone: 'wants' | 'stop' | 'clear'
  lead: string
  body: string
  cta?: { href: string; text: string }
}) {
  const toneClass = {
    wants: styles.headWants,
    stop: styles.headStop,
    clear: styles.headClear,
  }[tone]

  return (
    <div className={`${styles.head} ${toneClass}`}>
      <h1 className={styles.headline}>
        {figure !== undefined && <span className={styles.figure}>{figure}</span>}
        <span className={styles.lead}>{lead}</span>
      </h1>
      <p className={styles.body}>{body}</p>
      {cta && (
        <a className={styles.cta} href={cta.href}>
          {cta.text}
          <span aria-hidden="true"> →</span>
        </a>
      )}
    </div>
  )
}

function SectionHead({
  title,
  count,
  note,
}: {
  title: string
  count?: number
  note?: string
}) {
  return (
    <div className={styles.sectionHead}>
      <h2 className={styles.sectionTitle}>
        {title}
        {count !== undefined && <span className={styles.sectionCount}>{count}</span>}
      </h2>
      {note && <span className={styles.sectionNote}>{note}</span>}
    </div>
  )
}

/**
 * The empty table, and the difference between its two causes.
 *
 * With an agent, the next step is running it, so the page hands over the command instead of
 * describing one. Without an agent, the next step is upstream and the command would be
 * noise. These were one apologetic paragraph pointing at the other page, which is exactly
 * what an operator who already had an agent was shown.
 */
function NoPlansYet({ hasAgent }: { hasAgent: boolean }) {
  if (!hasAgent) {
    return (
      <div className={styles.invite}>
        <p className={styles.inviteTitle}>No agent, so nothing can submit a plan.</p>
        <p className={styles.inviteBody}>
          Create one below. You get a token back once; the agent sets it as{' '}
          <code>PLANBOUND_AGENT_TOKEN</code> and can then submit plans for you to approve.
        </p>
        <a className={styles.cta} href="#agents">
          Create an agent<span aria-hidden="true"> →</span>
        </a>
      </div>
    )
  }
  return (
    <div className={styles.invite}>
      <p className={styles.inviteTitle}>Your agent has not submitted a plan yet.</p>
      <p className={styles.inviteBody}>
        Give it a task with the token in its environment. It discovers sellers, probes them
        for live prices, and the priced plan lands in this table before anything is paid.
      </p>
      <pre className={styles.command}>
        <code>
          <span className={styles.commandDim}>export </span>PLANBOUND_AGENT_TOKEN=pbt_…
          {'\n'}
          <span className={styles.commandDim}>pnpm </span>driver &quot;vet 3 counterparty
          wallets before I pay them&quot;
        </code>
      </pre>
      <a className={styles.cta} href="#agents">
        Manage agents and tokens<span aria-hidden="true"> →</span>
      </a>
    </div>
  )
}
