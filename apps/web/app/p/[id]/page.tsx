import { notFound } from 'next/navigation'
import type { CSSProperties } from 'react'
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { safeEqual } from '@/lib/ids'
import { DecisionForm, type StepUpRequirement } from './decision-form'
import Link from 'next/link'
import { currentUser } from '@/lib/supabase/server'
import { Mark } from '../../(components)/mark'
import { Countdown } from './countdown'
import { DriftDiff } from './drift-diff'
import { Receipts } from './receipts'
import { Sellers } from './sellers'
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
  status: 'pending' | 'paid' | 'blocked' | 'skipped'
  paid_usd: number | string | null
  live_ask_usd: number | string | null
  receipt: { txRef?: string; network?: string; payTo?: string; at?: string } | null
}

/** Statuses where money has moved, so the page owes a reconciliation rather than a sentence. */
const SHOWS_RECEIPTS = new Set(['executing', 'settled', 'aborted'])

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

  const [{ data: stepRows }, { data: agent }, { data: envelope }] = await Promise.all([
    supabase
      .from('steps')
      .select('idx, service_name, quote_usd, source, buys, why, rail, status, paid_usd, live_ask_usd, receipt')
      .eq('plan_id', plan.id)
      .order('idx'),
    supabase.from('agents').select('name, ens').eq('id', plan.agent_id).maybeSingle(),
    supabase
      .from('envelopes')
      .select('funded_usd, swept_usd, hedera_account, hcs_topic')
      .eq('plan_id', plan.id)
      .maybeSingle(),
  ])
  const steps = (stepRows ?? []) as StepRow[]

  // Null for an approver arriving from a link with no account — which is the common case
  // and the one the capability URL exists to serve.
  const viewer = await currentUser()

  const isBlocked = plan.status === 'blocked'
  const blockedStep = steps.find((s) => s.status === 'blocked')
  const money = {
    ceilingUsd: Number(plan.ceiling_usd),
    fundedUsd: Number(envelope?.funded_usd ?? plan.ceiling_usd),
    tolerancePct: Number(plan.tolerance_pct),
    steps: steps.map((s) => ({
      quoteUsd: Number(s.quote_usd),
      status: s.status,
      paidUsd: s.paid_usd == null ? undefined : Number(s.paid_usd),
    })),
  }
  const driftSteps = steps.map((s) => ({
    idx: s.idx,
    serviceName: s.service_name,
    buys: s.buys,
    quoteUsd: Number(s.quote_usd),
    status: s.status,
    paidUsd: s.paid_usd == null ? undefined : Number(s.paid_usd),
    liveAskUsd: s.live_ask_usd == null ? undefined : Number(s.live_ask_usd),
  }))

  const total = Number(plan.total_usd)
  const ceiling = Number(plan.ceiling_usd)
  const expiresAt = new Date(plan.expires_at)
  const isExpired = expiresAt <= new Date()
  const isOpen = plan.status === 'pending_approval' && !isExpired
  // One token for the page, not one per component. Every server action reachable from here
  // is authorised by the same thing — proof the caller held the approval key — so minting a
  // second one would only mean two expiry clocks on a page the human reads as one.
  const decisionToken = mintDecisionToken(plan.approval_key, plan.id)
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

  // Presentation only: the envelope scale reads quoted against ceiling, and the span
  // between them is the drift headroom the rest of the product is about.
  const headroom = Math.max(0, ceiling - total)
  const fillPct = ceiling > 0 ? Math.min(100, (total / ceiling) * 100) : 0

  return (
    <main className={styles.page}>
      <article className={styles.sheet}>
        <header className={styles.masthead}>
          <Mark className={styles.brand} title="PlanBound" />
          <span className={styles.planId}>plan {plan.id}</span>
          {/* Live, and in the masthead. The clock is what makes the authority to spend
              temporary, so it belongs where the eye lands rather than three sections down
              beside the envelope. */}
          <Countdown
            expiresAt={plan.expires_at}
            className={styles.stamp}
            liveClassName={styles.stampPlain}
            expiredClassName={styles.stampStop}
          />
        </header>

        <h1 className={styles.goal}>&ldquo;{plan.goal}&rdquo;</h1>
        <p className={styles.agent}>{agent?.ens ?? agent?.name ?? 'unknown agent'}</p>

        <section className={`${styles.block} ${styles.section}`}>
          <p className={styles.eyebrow}>
            Approach
            {turns > 0 && (
              <span className={`${styles.stamp} ${styles.stampGood}`}>
                self-checked &times;{turns}
              </span>
            )}
          </p>
          <p className={styles.logic}>{plan.approach}</p>
          {fixes.length > 0 && (
            <ul className={styles.fixes}>
              {fixes.map((fix, i) => (
                <li key={i}>{fix}</li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${styles.block} ${styles.section}`}>
          <p className={styles.eyebrow}>Priced steps</p>
          <table className={styles.table}>
            <tbody>
              {steps.map((step, i) => (
                <tr key={step.idx}>
                  <td className={styles.idx}>{String(i + 1).padStart(2, '0')}</td>
                  <td>
                    <span className={styles.service}>{step.service_name}</span>
                    <span className={styles.why}>{step.why}</span>
                    <span className={styles.rail}>{step.rail}</span>
                  </td>
                  <td>
                    <span className={styles.stepPrice}>{usd(Number(step.quote_usd))}</span>
                    <span className={styles.stepSource}>
                      {step.source === 'live-402' ? (
                        <span
                          className={`${styles.stamp} ${styles.stampGood}`}
                          title="a live HTTP 402 quote from the seller"
                        >
                          live
                        </span>
                      ) : (
                        <span
                          className={`${styles.stamp} ${styles.stampWarn}`}
                          title="no published price — the agent's estimate"
                        >
                          est.
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
              <tr className={styles.totalRow}>
                <td className={styles.idx} />
                <td className={styles.totalLabel}>Total quoted</td>
                <td className={styles.amt}>{usd(total)}</td>
              </tr>
            </tbody>
          </table>

          {/* Only while there is still a decision to make. Once the money has moved, the
              receipts below are the stronger evidence — they name the transactions this
              plan itself produced, rather than what strangers paid the seller before. */}
          {(isOpen || isBlocked) && <Sellers planId={plan.id} token={decisionToken} />}
        </section>

        <section className={`${styles.block} ${styles.section}`}>
          <p className={styles.eyebrow}>Envelope</p>
          <div className={styles.envelopeFigures}>
            <div>
              <span className={styles.envelopeLabel}>Total quoted</span>
              <span className={styles.figure}>{usd(total)}</span>
            </div>
            <div className={styles.envelopeCeiling}>
              <span className={styles.envelopeLabel}>Ceiling</span>
              <span className={styles.figure}>{usd(ceiling)}</span>
            </div>
          </div>
          <div className={styles.scale}>
            <div
              className={styles.scaleFill}
              style={{ '--fill': `${fillPct.toFixed(1)}%` } as CSSProperties}
            />
          </div>
          <p className={styles.envelopeFoot}>
            <span>
              <b>{usd(headroom)}</b> drift headroom
            </span>
            <span className={styles.expiry}>
              {isExpired ? 'nothing can be funded from this plan' : `closes ${expiresAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`}
            </span>
          </p>
        </section>

        {isOpen ? (
          <section className={`${styles.block} ${styles.section}`}>
            <p className={styles.eyebrow}>Your decision</p>
            <DecisionForm
              planId={plan.id}
              token={decisionToken}
              approveLabel={`Approve ${usd(ceiling)} envelope`}
              steps={steps.map((s) => ({ idx: s.idx, name: s.service_name }))}
              stepUp={stepUp}
            />
            <p className={styles.note}>
              Approving funds a single-use envelope with exactly this ceiling &mdash; the agent
              cannot exceed it, and what it does not spend sweeps back at expiry.
            </p>
          </section>
        ) : isBlocked && blockedStep ? (
          // The plan stopped mid-execution because a seller changed its price. This is the
          // second decision the product exists to ask for, and it is priced, not a popup.
          <DriftDiff
            planId={plan.id}
            ticket={decisionToken}
            money={money}
            steps={driftSteps}
            blockedIdx={blockedStep.idx}
            liveAskUsd={Number(blockedStep.live_ask_usd ?? blockedStep.quote_usd)}
          />
        ) : (
          <>
            <div className={`${styles.block} ${styles.settled}`}>
              <h2>{settled?.title ?? plan.status}</h2>
              <p>{settled?.body ?? 'This plan is no longer awaiting an answer.'}</p>
            </div>
            {SHOWS_RECEIPTS.has(plan.status) && (
              <Receipts
                steps={driftSteps.map((s, i) => ({ ...s, receipt: steps[i]?.receipt ?? null }))}
                fundedUsd={envelope?.funded_usd == null ? null : Number(envelope.funded_usd)}
                sweptUsd={envelope?.swept_usd == null ? null : Number(envelope.swept_usd)}
                envelopeAccount={envelope?.hedera_account ?? null}
                hcsTopic={envelope?.hcs_topic ?? null}
              />
            )}
          </>
        )}
      </article>
      <p className={styles.footer}>
        {/* Only for someone who already has an account.
            This page is a capability URL — it is routinely opened by a person with no
            account at all, invited by a link. A "back to console" they cannot reach would
            walk them into a login wall on a page they were sent to on purpose. Shown when
            there is a session, absent when there is not. */}
        {viewer && (
          <>
            <Link className={styles.backLink} href="/console">
              &larr; Back to console
            </Link>
            <span className={styles.footerSep} aria-hidden="true">
              &middot;
            </span>
          </>
        )}
        This page is rendered from the record, not from the agent.
      </p>
    </main>
  )
}
