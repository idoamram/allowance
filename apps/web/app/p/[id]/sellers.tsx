'use client'

import { useState } from 'react'
import { usd } from '@/lib/format'
import { checkSellers, type SellerCheck, type TrustState } from './trust-actions'
import styles from './approval.module.css'

/**
 * "Has anyone ever actually paid these sellers?" — asked by the human, at the moment the
 * question is live.
 *
 * The priced steps above are two claims: a directory listing says the seller exists, and a
 * live 402 says it will quote a price. Neither is history. This is the third thing, and the
 * only one the seller cannot author: an independent index of what has settled to its own
 * payout address on chain.
 *
 * A button rather than a panel, because the check costs a live probe per seller plus a
 * subgraph query, and because the deliberate act of asking is what makes the answer mean
 * something. Nobody reads a number that was already on the page.
 */
export function Sellers({ planId, token }: { planId: string; token: string }) {
  const [state, setState] = useState<TrustState | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    setState(await checkSellers(planId, token))
    setBusy(false)
  }

  return (
    <div className={styles.trust}>
      {state?.kind !== 'ok' && (
        <button
          type="button"
          className={`${styles.btn} ${styles.ghost}`}
          onClick={run}
          disabled={busy}
        >
          {busy ? 'Reading the chain…' : 'Check these sellers on chain'}
        </button>
      )}

      {state?.kind === 'error' && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}

      {state?.kind === 'ok' && (
        <div className={styles.trustResult}>
          <p className={styles.eyebrow}>Settlement history</p>
          <ul className={styles.trustList}>
            {state.checks.map((check) => (
              <SellerRow key={check.idx} check={check} />
            ))}
          </ul>
          <p className={styles.trustFoot}>
            Indexed from {state.chain} by a subgraph on The Graph, from the seller&rsquo;s own payout address. Not our record of what we paid &mdash; the chain&rsquo;s.
          </p>
        </div>
      )}
    </div>
  )
}

function SellerRow({ check }: { check: SellerCheck }) {
  // Absence is reported as absence. A seller with no history is unproven, which is a
  // different thing from proven bad, and typing it in the stop colour would say the
  // second while meaning the first.
  const known = check.settlements > 0

  return (
    <li className={styles.trustRow}>
      <div className={styles.trustHead}>
        <span className={styles.service}>{check.serviceName}</span>
        <span className={`${styles.stamp} ${known ? styles.stampGood : styles.stampPlain}`}>
          {known ? `${check.settlements} paid` : 'no history'}
        </span>
      </div>

      {known ? (
        <dl className={styles.trustFigures}>
          <div>
            <dt>Payers</dt>
            <dd>{check.uniquePayers}</dd>
          </div>
          <div>
            <dt>Received</dt>
            <dd>{usd(check.totalReceivedUsd)}</dd>
          </div>
          <div>
            <dt>First seen</dt>
            <dd>{check.firstSeen ? new Date(check.firstSeen * 1000).toLocaleDateString('en-GB') : '—'}</dd>
          </div>
        </dl>
      ) : (
        <p className={styles.trustNote}>{check.note}</p>
      )}

      {check.payTo && <p className={styles.trustAddr}>{check.payTo}</p>}
    </li>
  )
}
