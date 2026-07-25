import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { safeEqual } from '@/lib/ids'
import { DecisionForm, type StepUpRequirement } from './decision-form'
import { Countdown } from './countdown'
import { mintDecisionToken } from './token'
import { usd } from '@/lib/format'
import { humanVerifierOrError, DEFAULT_STEP_UP_USD } from '@/lib/verify'
import styles from './approval.module.css'

export const dynamic = 'force-dynamic'

/** The approval link must not turn up in a search index or a link preview. */
export const metadata: Metadata = { robots: { index: false, follow: false } }

type PlanRow = {
  id: string
  agent_id: string
  goal: string
  approach: string
  total_usd: number | string
  ceiling_usd: number | string
  tolerance_pct: number | string
  status: string
  self_check: { turns?: number; fixes?: string[] } | null
  approval_key: string
  expires_at: string
}

type StepRow = {
  idx: number
  service_name: string
  quote_usd: number | string
  source: 'live-402' | 'estimate'
  buys: string
  why: string
  rail: string
}

/** What the plan's status means for the human now that it is no longer theirs to answer. */
const SETTLED_COPY: Record<string, { title: string; body: string }> = {
  approved: {
    title: 'Approved',
    body: 'The envelope is funded to the ceiling below. The agent runs inside it and cannot exceed it.',
  },
  rejected: {
    title: 'Rejected',
    body: 'Nothing was funded. Your typed reason is what the next plan is shaped by.',
  },
  executing: { title: 'Running', body: 'The agent is spending inside the approved envelope.' },
  blocked: { title: 'Blocked on drift', body: 'A step asked more than it quoted. The diff is where you decide.' },
  settled: { title: 'Settled', body: 'The plan finished. Unspent funds swept back at expiry.' },
  aborted: { title: 'Aborted', body: 'The plan was stopped. The remainder was swept back.' },
  expired: { title: 'Expired', body: 'This plan was never approved in time. Nothing was funded.' },
}

export default async function ApprovalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ k?: string }>
}) {
  const { id } = await params
  const { k = '' } = await searchParams
  const supabase = db()

  const { data } = await supabase
    .from('plans')
    .select(
      'id, agent_id, goal, approach, total_usd, ceiling_usd, tolerance_pct, status, self_check, approval_key, expires_at',
    )
    .eq('id', id)
    .maybeSingle()
  const plan = data as PlanRow | null

  // A wrong key is indistinguishable from a missing plan: the URL is the credential,
  // so a 404 is the only thing this page ever admits to.
  if (!plan || !safeEqual(k, plan.approval_key)) notFound()

  const [{ data: stepRows }, { data: agent }] = await Promise.all([
    supabase
      .from('steps')
      .select('idx, service_name, quote_usd, source, buys, why, rail')
      .eq('plan_id', plan.id)
      .order('idx'),
    supabase.from('agents').select('name, ens').eq('id', plan.agent_id).maybeSingle(),
  ])
  const steps = (stepRows ?? []) as StepRow[]

  const total = Number(plan.total_usd)
  const ceiling = Number(plan.ceiling_usd)
  const expiresAt = new Date(plan.expires_at)
  const isExpired = expiresAt <= new Date()
  const isOpen = plan.status === 'pending_approval' && !isExpired
  const turns = plan.self_check?.turns ?? 0
  const fixes = plan.self_check?.fixes ?? []
  const settled = SETTLED_COPY[isExpired && plan.status === 'pending_approval' ? 'expired' : plan.status]

  // Step-up is decided from the plan's own ceiling by whichever verifier this deployment
  // runs. With the default (`none`) this is always null and the page is unchanged — which
  // is the point of the seam: World is a registration, not a rewrite.
  const forVerifier = { planId: plan.id, ceilingUsd: ceiling, goal: plan.goal }
  const selected = humanVerifierOrError()
  let stepUp: StepUpRequirement | null = null
  if (!selected.verifier) {
    // Fails closed for every ceiling: the operator opted into a verifier and it did not
    // load, so we cannot know which plans it would have asked about.
    stepUp = { ceilingLabel: usd(ceiling), thresholdLabel: '', configError: selected.error }
  } else if (selected.verifier.required(forVerifier)) {
    stepUp = {
      ceilingLabel: usd(ceiling),
      thresholdLabel: usd(Number(process.env.STEP_UP_USD ?? DEFAULT_STEP_UP_USD)),
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.planId}>Plan {plan.id}</span>
          <span className={`${styles.stamp} ${styles.stampPlain}`}>
            expires{' '}
            {expiresAt.toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'UTC',
            })}{' '}
            UTC
          </span>
        </div>

        <p className={styles.goal}>&ldquo;{plan.goal}&rdquo;</p>
        <p className={styles.agent}>{agent?.ens ?? agent?.name ?? 'unknown agent'}</p>

        <p className={styles.logic}>
          <b>Logic:</b> {plan.approach}
          {turns > 0 && (
            <>
              {' '}
              &middot;{' '}
              <span className={`${styles.stamp} ${styles.stampGood}`}>self-checked &times;{turns}</span>
            </>
          )}
        </p>
        {fixes.length > 0 && (
          <ul className={styles.fixes}>
            {fixes.map((fix, i) => (
              <li key={i}>{fix}</li>
            ))}
          </ul>
        )}

        <table className={styles.table}>
          <tbody>
            {steps.map((step) => (
              <tr key={step.idx}>
                <td>
                  <span className={styles.service}>{step.service_name}</span>
                  <span className={styles.why}>{step.why}</span>
                </td>
                <td>
                  <span className={styles.amt}>{usd(Number(step.quote_usd))}</span>{' '}
                  {step.source === 'live-402' ? (
                    <span className={`${styles.stamp} ${styles.stampGood}`} title="a live HTTP 402 quote from the seller">
                      live
                    </span>
                  ) : (
                    <span className={`${styles.stamp} ${styles.stampWarn}`} title="no published price — the agent's estimate">
                      est.
                    </span>
                  )}
                </td>
              </tr>
            ))}
            <tr className={styles.totalRow}>
              <td>Total quoted</td>
              <td className={styles.amt}>{usd(total)}</td>
            </tr>
          </tbody>
        </table>

        <div className={styles.ceiling}>
          <span>Ceiling (drift headroom)</span>
          <span className={styles.amt}>{usd(ceiling)}</span>
        </div>
        <div className={styles.expiry}>
          <Countdown expiresAt={plan.expires_at} />
        </div>

        {isOpen ? (
          <>
            <DecisionForm
              planId={plan.id}
              token={mintDecisionToken(plan.approval_key, plan.id)}
              approveLabel={`Approve ${usd(ceiling)} envelope`}
              steps={steps.map((s) => ({ idx: s.idx, name: s.service_name }))}
              stepUp={stepUp}
            />
            <p className={styles.note}>
              Approving funds a single-use envelope with exactly this ceiling &mdash; the agent
              cannot exceed it, and what it does not spend sweeps back at expiry.
            </p>
          </>
        ) : (
          <div className={styles.settled}>
            <h2>{settled?.title ?? plan.status}</h2>
            <p>{settled?.body ?? 'This plan is no longer awaiting an answer.'}</p>
          </div>
        )}
      </div>
      <p className={styles.footer}>
        PlanBound &middot; this page is rendered from the record, not from the agent.
      </p>
    </main>
  )
}
