import 'server-only'
import { db } from './db'
import { type Claim, type ReconRow, reconcile } from './reconcile'
import { indexWindow, settlementsByPayers, subgraphUrl } from './subgraph'

/**
 * Reads both sides of the claimed-vs-settled diff: our own `steps` rows, and the USDC
 * settlements The Graph indexed from Worldchain consensus. The matching lives in
 * `reconcile.ts`; this file is only the IO around it.
 *
 * Scope is deliberately narrow — Worldchain USDC only. Hedera-rail steps settle on a chain
 * The Graph does not index, so they are excluded rather than silently counted as unsettled.
 */

export type PanelState =
  | { kind: 'not_configured' }
  | { kind: 'unreachable' }
  | { kind: 'no_wallets' }
  | { kind: 'ready'; rows: ReconRow[]; indexedSinceTimestamp: number | null; walletCount: number }

interface StepRow {
  plan_id: string
  idx: number
  service_name: string
  paid_usd: number | string | null
  receipt: { txRef?: string } | null
}

/**
 * Every failure mode is its own state rather than an empty table: "the subgraph is not
 * deployed" and "the chain shows nothing settled" mean opposite things to an approver, and
 * a verification panel that blurs them is worse than no panel.
 */
export async function loadClaimedVsSettled(): Promise<PanelState> {
  if (!subgraphUrl()) return { kind: 'not_configured' }

  const client = db()
  const { data: envelopeRows } = await client
    .from('envelopes')
    .select('plan_id, evm_address')
    .not('evm_address', 'is', null)

  const walletByPlan = new Map<string, string>()
  for (const e of (envelopeRows ?? []) as { plan_id: string; evm_address: string }[]) {
    walletByPlan.set(e.plan_id, e.evm_address)
  }
  const wallets = [...new Set(walletByPlan.values())]
  if (wallets.length === 0) return { kind: 'no_wallets' }

  const { data: stepRows } = await client
    .from('steps')
    .select('plan_id, idx, service_name, paid_usd, receipt')
    .eq('rail', 'worldchain')
    .eq('status', 'paid')
    .in('plan_id', [...walletByPlan.keys()])

  const claims: Claim[] = ((stepRows ?? []) as StepRow[]).flatMap((s) => {
    const payer = walletByPlan.get(s.plan_id)
    if (!payer) return []
    return [
      {
        planId: s.plan_id,
        stepIdx: s.idx,
        serviceName: s.service_name,
        payer,
        claimedUsd: Number(s.paid_usd ?? 0),
        txRef: s.receipt?.txRef ?? null,
      },
    ]
  })

  const [settlements, window] = await Promise.all([settlementsByPayers(wallets), indexWindow()])
  if (settlements === null) return { kind: 'unreachable' }

  return {
    kind: 'ready',
    rows: reconcile(claims, settlements),
    indexedSinceTimestamp: window ? Number(window.firstIndexedTimestamp) : null,
    walletCount: wallets.length,
  }
}
