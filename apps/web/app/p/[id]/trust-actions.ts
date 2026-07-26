'use server'

import { probe } from '@planbound/chains'
import { db } from '@/lib/db'
import {
  SETTLEMENT_CHAIN_NAME,
  SETTLEMENT_NETWORK,
  sellerTrust,
  subgraphUrl,
} from '@/lib/subgraph'
import { verifyDecisionToken } from './token'

/**
 * "Has anyone ever actually paid this seller?"
 *
 * The one question neither half of discovery can answer. A Bazaar listing is a claim the
 * seller makes about itself. A live 402 proves it is awake and will quote a price. Neither
 * says whether a single payment has ever landed and produced anything — and the human is
 * about to fund strangers a directory recommended.
 *
 * Only an index of the chain answers it, which is what The Graph is doing here: the seller's
 * own `payTo` address, and what has settled to it.
 *
 * Deliberately on demand rather than on page load. It probes every seller live and then
 * queries the subgraph, which is seconds of work — spending that on every render of a page
 * most people will approve without asking would be the wrong trade. The button is the
 * question being asked.
 */

export interface SellerCheck {
  idx: number
  serviceName: string
  /** null when the seller did not answer a 402 on the indexed rail — it may settle elsewhere. */
  payTo: string | null
  settlements: number
  uniquePayers: number
  totalReceivedUsd: number
  firstSeen: number | null
  /** Why there is nothing to report, when there is nothing to report. */
  note?: string
}

export type TrustState =
  | { kind: 'ok'; chain: string; checks: SellerCheck[] }
  | { kind: 'error'; message: string }

export async function checkSellers(planId: string, token: string): Promise<TrustState> {
  const supabase = db()
  const { data: plan } = await supabase
    .from('plans')
    .select('id, approval_key')
    .eq('id', planId)
    .maybeSingle()

  // Same authority as approving: whoever holds the link may ask about it. This reads
  // public chain data about third parties and reveals nothing about the plan, but gating
  // it identically keeps one answer to "who may see this page's contents".
  if (!plan || !verifyDecisionToken(token, plan.approval_key, planId)) {
    return { kind: 'error', message: 'This page is no longer valid. Open the approval link again.' }
  }

  if (!subgraphUrl()) {
    return {
      kind: 'error',
      message:
        'No settlement index is connected, so there is nothing to check these sellers against.',
    }
  }

  const { data: steps } = await supabase
    .from('steps')
    .select('idx, service_name, service_url')
    .eq('plan_id', planId)
    .order('idx')

  const rows = (steps ?? []) as { idx: number; service_name: string; service_url: string }[]

  const checks = await Promise.all(
    rows.map(async (step): Promise<SellerCheck> => {
      const base = { idx: step.idx, serviceName: step.service_name }

      // The seller's payTo is the seller's to change, so it is read live rather than from
      // anything we stored. Scoring a stale address would report zero for a busy seller.
      const quote = await probe(step.service_url, { network: SETTLEMENT_NETWORK, timeoutMs: 8000 })
      if (!quote?.payTo) {
        return {
          ...base,
          payTo: null,
          settlements: 0,
          uniquePayers: 0,
          totalReceivedUsd: 0,
          firstSeen: null,
          note: `no ${SETTLEMENT_CHAIN_NAME} offer — this seller settles on another rail, so the index cannot see it`,
        }
      }

      const trust = await sellerTrust(quote.payTo)
      return {
        ...base,
        payTo: quote.payTo,
        settlements: trust?.settlementCount ?? 0,
        uniquePayers: trust?.uniquePayerCount ?? 0,
        totalReceivedUsd: trust?.totalReceivedUsd ?? 0,
        firstSeen: trust?.firstSeenTimestamp ?? null,
        // Zero is a real answer and has to read as one. A new seller and a seller nobody
        // will pay look identical here, and saying so is more useful than a red flag.
        note:
          (trust?.settlementCount ?? 0) === 0
            ? 'nothing settled to this address since indexing began — new, or untested'
            : undefined,
      }
    }),
  )

  return { kind: 'ok', chain: SETTLEMENT_CHAIN_NAME, checks }
}
