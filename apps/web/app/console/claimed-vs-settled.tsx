import { loadClaimedVsSettled } from '@/lib/claimed-vs-settled'
import { supabaseServer } from '@/lib/supabase/server'
import type { ReconRow } from '@/lib/reconcile'
import { usd } from '@/lib/format'
import styles from './claimed.module.css'

/**
 * Claimed vs settled.
 *
 * Every other number in this console comes from our own database — which is exactly why
 * none of them prove anything. This panel puts our claims next to what The Graph indexed
 * from Worldchain consensus, so an approver can check the control plane against the chain
 * without taking our word for either side.
 *
 * Two disagreements matter, and they point in opposite directions:
 *   unsettled — we recorded a payment consensus never saw.
 *   unclaimed — money left a plan wallet and we recorded nothing. Our database cannot
 *               surface this one at all; only an address-keyed index of the chain can.
 */

const LABEL: Record<ReconRow['status'], string> = {
  matched: 'matched',
  amount_mismatch: 'amount differs',
  unsettled: 'not on chain',
  unclaimed: 'unrecorded spend',
}

const FLAGGED: ReconRow['status'][] = ['amount_mismatch', 'unsettled', 'unclaimed']

const short = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`

function isoDay(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 16)
}

export default async function ClaimedVsSettled() {
  // The cookie-bound client, so this panel sees only the signed-in human's envelopes.
  const state = await loadClaimedVsSettled(await supabaseServer())

  const body = () => {
    switch (state.kind) {
      case 'not_configured':
        return (
          <p className={styles.state}>
            The settlement subgraph is not connected &mdash; <code>SUBGRAPH_URL</code> is unset,
            so there is nothing to check our records against. This panel stays empty rather
            than showing our own numbers back to you and calling it verification.
          </p>
        )
      case 'unreachable':
        return (
          <p className={styles.state}>
            The subgraph did not answer. Nothing is shown: a verification panel that falls
            back to our own database is not a verification panel.
          </p>
        )
      case 'no_wallets':
        return (
          <p className={styles.state}>
            No plan wallet has been minted yet, so there is nothing on Worldchain to compare
            against. Rows appear here the first time an approved plan spends on that rail.
          </p>
        )
      case 'ready':
        if (state.rows.length === 0) {
          return (
            <p className={styles.state}>
              {state.walletCount} plan wallet{state.walletCount === 1 ? '' : 's'} indexed, and
              neither we nor the chain records a single Worldchain payment. Agreement on zero
              is still agreement.
            </p>
          )
        }
        return (
          <div className={styles.scroller}>
            <table className={styles.table}>
            <thead>
              <tr>
                <th>Step</th>
                <th>Verdict</th>
                <th className={styles.num}>We claim</th>
                <th className={styles.num}>Chain says</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row, i) => (
                <tr
                  key={`${row.planId ?? 'chain'}-${row.stepIdx ?? i}-${row.txHash ?? i}`}
                  className={FLAGGED.includes(row.status) ? styles.rowFlagged : undefined}
                >
                  <td>
                    <span className={styles.mono}>
                      {row.planId ? `${row.planId} · #${row.stepIdx}` : 'no record'}
                    </span>
                    <span className={styles.service}>
                      {row.serviceName ?? `paid ${short(row.settledTo ?? '0x')}`}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`${styles.badge} ${
                        row.status === 'matched' ? styles.badgeOk : styles.badgeBad
                      }`}
                    >
                      {LABEL[row.status]}
                    </span>
                    {row.matchedBy === 'amount' && (
                      <span className={styles.evidence}>
                        matched by payer + amount, no tx hash in the receipt
                      </span>
                    )}
                  </td>
                  <td className={styles.num}>
                    {row.claimedUsd === null ? '—' : usd(row.claimedUsd)}
                  </td>
                  <td className={styles.num}>
                    {row.settledUsd === null ? '—' : usd(row.settledUsd)}
                  </td>
                  <td className={styles.mono}>
                    {row.txHash ? short(row.txHash) : '—'}
                    {row.blockTimestamp && (
                      <span className={styles.evidence}>{isoDay(row.blockTimestamp)} UTC</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        )
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>Claimed vs settled</h2>
        {state.kind === 'ready' && state.indexedSinceTimestamp && (
          <span className={styles.since}>
            settled since deployment &mdash; indexing from {isoDay(state.indexedSinceTimestamp)} UTC
          </span>
        )}
      </div>
      <p className={styles.sub}>
        What this control plane says it paid, against what The Graph indexed from Worldchain
        consensus. If the two ever disagree, the disagreement is the row you are looking at
        &mdash; you do not have to trust us to see it.
      </p>
      {body()}
      <p className={styles.note}>
        Worldchain USDC only. Hedera-rail steps settle on a chain The Graph does not index,
        so they are left out rather than counted as unsettled. Counts cover the period since
        this subgraph was deployed, never lifetime history.
      </p>
    </section>
  )
}
