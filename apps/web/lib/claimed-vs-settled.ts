import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { type Claim, type ReconRow, reconcile } from './reconcile'
import { indexWindow, settlementsByPayers, subgraphUrl } from './subgraph'

/**
 * Reads both sides of the claimed-vs-settled diff: our own `steps` rows, and the USDC
 * settlements The Graph indexed from consensus. The matching lives in `reconcile.ts`; this
 * file is only the IO around it.
 *
 * **The rail here must match the subgraph's manifest.** `subgraph/subgraph.yaml` indexes
 * Base USDC, so this reads Base-rail steps. It read `worldchain` until 2026-07-26, left
 * behind when Subgraph Studio dropped WorldChain support and the manifest was repointed to
 * Base in #31 — so the panel compared Worldchain claims against Base settlements, matched
 * nothing by construction, and would have reported every honest payment as "not on chain".
 *
 * That failure mode is worse here than anywhere else in the app: this is the panel whose
 * whole purpose is letting someone check us without trusting us. A verification surface
 * that silently verifies nothing is more dangerous than no verification surface.
 *
 * Hedera-rail steps stay excluded rather than counted as unsettled — The Graph does not
 * index Hedera, so their absence from the index is not evidence of anything.
 *
 * The caller supplies the client rather than this module reaching for the service-role one.
 * That is a security boundary, not a style preference: this panel selects envelope wallet
 * addresses and plan ids, so under the service-role client it would show one signed-in
 * human every other human's envelopes. Handed the cookie-bound client, the RLS policies
 * from migration 0004 scope it to the caller's own plans.
 */

/**
 * The rail the deployed subgraph indexes. Named once and exported so the panel's copy can
 * read it rather than hardcode a chain name a second time — the last drift between those
 * two places went unnoticed because they were edited in different PRs.
 */
export const INDEXED_RAIL = 'base' as const

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
export async function loadClaimedVsSettled(client: SupabaseClient): Promise<PanelState> {
  if (!subgraphUrl()) return { kind: 'not_configured' }

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
    // Must equal the network in subgraph/subgraph.yaml. See the note at the top of this
    // file: a mismatch here does not error, it silently reconciles nothing.
    .eq('rail', INDEXED_RAIL)
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
