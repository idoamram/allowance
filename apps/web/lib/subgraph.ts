import 'server-only'
import type { SettlementLike } from './reconcile'

/**
 * Read side of the Worldchain settlement subgraph (`subgraph/`).
 *
 * The point of routing through The Graph rather than our own RPC calls is independence:
 * the console's claimed-vs-settled panel compares what our Postgres says we paid against
 * what a third party indexed from consensus. If those two agree, the approver has checked
 * our backend without having to trust it.
 *
 * Everything here degrades to `null` when `SUBGRAPH_URL` is unset or the endpoint is
 * unreachable. Callers render an honest "not indexed" state — a verification panel that
 * invents numbers when its source is down is worse than no panel.
 */

/** Worldchain mainnet, CAIP-2. The only rail this subgraph covers. */
/**
 * The rail the subgraph indexes. Base since 2026-07-25: Subgraph Studio dropped subgraph
 * support for Worldchain, so we index where our EVM settlements actually land.
 * Everything downstream reads this rather than a literal.
 */
export const SETTLEMENT_NETWORK = 'eip155:8453'

/** @deprecated kept so an older import keeps compiling; points at the indexed rail. */
export const WORLDCHAIN_NETWORK = SETTLEMENT_NETWORK

/**
 * The Studio query URL is treated as a secret: gateway URLs carry an API key in the path,
 * so this module stays `server-only` and the endpoint is never shipped to a browser bundle.
 */
export function subgraphUrl(): string | null {
  return process.env.SUBGRAPH_URL?.trim() || null
}

async function query<T>(doc: string, variables: Record<string, unknown>): Promise<T | null> {
  const url = subgraphUrl()
  if (!url) return null
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: doc, variables }),
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: T; errors?: unknown[] }
    if (json.errors?.length) return null
    return json.data ?? null
  } catch {
    return null
  }
}

export interface IndexWindow {
  firstIndexedBlock: string
  firstIndexedTimestamp: string
  lastIndexedBlock: string
  lastIndexedTimestamp: string
  settlementCount: string
}

/**
 * The real indexing window. The console prints this rather than asserting a period: the
 * subgraph starts from a recent block so it syncs in minutes, which is exactly why the
 * honest claim is "settled since deployment" and never "this month".
 */
export async function indexWindow(): Promise<IndexWindow | null> {
  const data = await query<{ indexMeta: IndexWindow | null }>(
    `query { indexMeta(id: "meta") {
       firstIndexedBlock firstIndexedTimestamp lastIndexedBlock lastIndexedTimestamp settlementCount
     } }`,
    {},
  )
  return data?.indexMeta ?? null
}

export interface SellerTrust {
  payTo: string
  settlementCount: number
  uniquePayerCount: number
  totalReceivedUsd: number
  firstSeenTimestamp: number
  lastSeenTimestamp: number
}

/**
 * Settlement history for one payTo address. This is the discovery-ranking input: an address
 * strangers keep paying is a weaker claim to fake than a listing in a catalog.
 *
 * A seller with no rows is not "untrustworthy" — it may simply predate our startBlock or
 * settle on another chain. Callers must present absence as absence, not as a bad score.
 */
export async function sellerTrust(payTo: string): Promise<SellerTrust | null> {
  const id = payTo.toLowerCase()
  const data = await query<{
    seller: {
      id: string
      settlementCount: string
      uniquePayerCount: string
      totalReceivedUsd: string
      firstSeenTimestamp: string
      lastSeenTimestamp: string
    } | null
  }>(
    `query Seller($id: ID!) { seller(id: $id) {
       id settlementCount uniquePayerCount totalReceivedUsd firstSeenTimestamp lastSeenTimestamp
     } }`,
    { id },
  )
  const seller = data?.seller
  if (!seller) return null
  return {
    payTo: seller.id,
    settlementCount: Number(seller.settlementCount),
    uniquePayerCount: Number(seller.uniquePayerCount),
    totalReceivedUsd: Number(seller.totalReceivedUsd),
    firstSeenTimestamp: Number(seller.firstSeenTimestamp),
    lastSeenTimestamp: Number(seller.lastSeenTimestamp),
  }
}

/** Superset of `SettlementLike` in `reconcile.ts` — that module owns the matching contract. */
export interface Settlement extends SettlementLike {
  amountUsd: string
  blockNumber: string
}

/**
 * Every USDC transfer these addresses sent, since indexing began. Our plan wallets are the
 * payers, so this is the chain's own answer to "what did PlanBound actually spend" —
 * derived without reading a single row of ours.
 */
export async function settlementsByPayers(payers: string[]): Promise<Settlement[] | null> {
  if (payers.length === 0) return []
  const data = await query<{ settlements: Settlement[] }>(
    `query Settlements($payers: [String!]!) {
       settlements(where: { from_in: $payers }, orderBy: blockNumber, orderDirection: asc, first: 500) {
         id from to amount amountUsd blockNumber blockTimestamp transactionHash
       }
     }`,
    { payers: payers.map((p) => p.toLowerCase()) },
  )
  return data?.settlements ?? null
}
