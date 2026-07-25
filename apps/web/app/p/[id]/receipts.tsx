import { hashscan } from '@planbound/chains/hedera'
import { usd } from '@/lib/format'
import styles from './approval.module.css'

export interface ReceiptStep {
  idx: number
  serviceName: string
  buys: string
  quoteUsd: number
  paidUsd?: number
  status: string
  receipt?: { txRef?: string; network?: string; payTo?: string; at?: string } | null
}

/**
 * What a finished plan leaves behind: quoted against paid against swept, per step, with
 * the chain reference for each payment. The three totals are the whole accountability
 * claim — anyone can check the last one on a block explorer without asking us.
 */
export function Receipts({
  steps,
  fundedUsd,
  sweptUsd,
  envelopeAccount,
  hcsTopic,
}: {
  steps: ReceiptStep[]
  fundedUsd: number | null
  sweptUsd: number | null
  envelopeAccount: string | null
  hcsTopic: string | null
}) {
  const quoted = steps.reduce((s, x) => s + x.quoteUsd, 0)
  const paid = steps.reduce((s, x) => s + (x.paidUsd ?? 0), 0)

  return (
    <section className={styles.receipts}>
      <h2 className={styles.receiptsTitle}>Receipts</h2>

      <ol className={styles.receiptList}>
        {steps.map((s) => (
          <li key={s.idx} className={styles.receiptRow} data-status={s.status}>
            <span className={styles.receiptBody}>
              <b>{s.serviceName}</b>
              <span className={styles.driftBuys}>{s.buys}</span>
              {s.receipt?.txRef && s.receipt.txRef !== 'unknown' && (
                <span className={styles.receiptTx}>
                  {s.receipt.network?.startsWith('hedera:') ? (
                    <a href={hashscan.tx(s.receipt.txRef)} rel="noreferrer noopener" target="_blank">
                      {s.receipt.txRef}
                    </a>
                  ) : (
                    <span title={s.receipt.network ?? ''}>{s.receipt.txRef}</span>
                  )}
                </span>
              )}
            </span>
            <span className={styles.receiptPrice}>
              {s.status === 'paid' ? (
                <>
                  {usd(s.paidUsd ?? 0)}
                  {Math.abs((s.paidUsd ?? 0) - s.quoteUsd) > 0.000001 && (
                    <span className={styles.receiptQuoted}> quoted {usd(s.quoteUsd)}</span>
                  )}
                </>
              ) : (
                <span className={styles.driftPending}>
                  {s.status === 'skipped' ? 're-planned' : 'not paid'} · {usd(s.quoteUsd)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      <dl className={styles.driftMoney}>
        <div>
          <dt>Quoted</dt>
          <dd>{usd(quoted)}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd>{usd(paid)}</dd>
        </div>
        <div>
          <dt>Swept back</dt>
          <dd>{sweptUsd == null ? <span className={styles.driftPending}>at expiry</span> : usd(sweptUsd)}</dd>
        </div>
      </dl>

      <p className={styles.receiptsFoot}>
        {fundedUsd != null && <>Funded {usd(fundedUsd)}. </>}
        {envelopeAccount && (
          <>
            Envelope{' '}
            <a href={hashscan.account(envelopeAccount)} rel="noreferrer noopener" target="_blank">
              {envelopeAccount}
            </a>
            .{' '}
          </>
        )}
        {hcsTopic && (
          <>
            Every event on{' '}
            <a href={hashscan.topic(hcsTopic)} rel="noreferrer noopener" target="_blank">
              topic {hcsTopic}
            </a>
            , which you can read without us.
          </>
        )}
      </p>
    </section>
  )
}
