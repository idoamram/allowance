import { NextResponse } from 'next/server'
import demoSellers from '@planbound/chains/demo-sellers.json'
import { agentFromRequest } from '@/lib/auth'
import { SETTLEMENT_NETWORK, indexWindow, sellerTrust, subgraphUrl } from '@/lib/subgraph'

export const dynamic = 'force-dynamic'

/**
 * `GET /api/mcp/seller-trust?host=…` — settlement history for a seller, as a discovery
 * ranking input.
 *
 * A Bazaar listing is a claim. A 402 probe proves the seller is alive. Neither says whether
 * anyone has ever actually paid them. This route answers that from The Graph: how many USDC
 * settlements this seller's payTo address has received on the indexed rail since we started
 * indexing, and from how many distinct payers.
 *
 * The address is resolved by probing the seller live rather than from a stored table,
 * because payTo is the seller's to change and a stale mapping would score the wrong
 * address. Query by `?payTo=` directly when the caller has already probed.
 */

type SellerEntry = { url: string; name: string; priceUsd: number; source: string }
const CATALOG = demoSellers as Record<string, SellerEntry[]>

interface Accepts {
  scheme: string
  network: string
  amount: string
  asset: string
  payTo: string
}

/**
 * Read the seller's live 402 and take the indexed rail's offer specifically. A seller commonly
 * offers several chains; scoring one chain's payTo against another chain's index would silently
 * report zero for a busy seller, which is worse than reporting nothing.
 */
async function probeIndexedPayTo(
  url: string,
): Promise<{ payTo: string; priceUsd: number } | null> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' })
  } catch {
    return null
  }
  if (res.status !== 402) return null

  const bodyText = await res.text().catch(() => '')
  let payload: { accepts?: Accepts[] } | null = null
  const header = res.headers.get('payment-required')
  if (header) {
    try {
      payload = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    } catch {
      payload = null
    }
  }
  if (!payload && bodyText) {
    try {
      payload = JSON.parse(bodyText)
    } catch {
      payload = null
    }
  }

  const accepts = payload?.accepts?.find(
    (a) => a.network === SETTLEMENT_NETWORK && a.scheme === 'exact',
  )
  if (!accepts) return null
  return { payTo: accepts.payTo, priceUsd: Number(accepts.amount) / 1e6 }
}

function endpointsForHost(host: string): string[] {
  const wanted = host.toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
  const urls: string[] = []
  for (const entries of Object.values(CATALOG)) {
    for (const entry of entries) {
      try {
        if (new URL(entry.url).host.toLowerCase() === wanted) urls.push(entry.url)
      } catch {
        // a malformed catalog url is not worth failing the request over
      }
    }
  }
  return urls
}

export async function GET(req: Request) {
  const agent = await agentFromRequest(req)
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (!subgraphUrl()) {
    return NextResponse.json(
      {
        error: 'subgraph_not_configured',
        detail: 'SUBGRAPH_URL is unset — seller trust has no source. See subgraph/README.md.',
      },
      { status: 503 },
    )
  }

  const params = new URL(req.url).searchParams
  const host = params.get('host')
  const url = params.get('url')
  let payTo = params.get('payTo')
  let priceUsd: number | null = null

  if (!payTo) {
    const candidates = url ? [url] : host ? endpointsForHost(host) : []
    if (candidates.length === 0) {
      return NextResponse.json(
        {
          error: 'unknown_seller',
          detail: host
            ? `no endpoint for host "${host}" in the seller catalog — pass ?url= or ?payTo= instead`
            : 'pass ?host=, ?url= or ?payTo=',
        },
        { status: 404 },
      )
    }
    for (const candidate of candidates) {
      const probed = await probeIndexedPayTo(candidate)
      if (probed) {
        payTo = probed.payTo
        priceUsd = probed.priceUsd
        break
      }
    }
    if (!payTo) {
      return NextResponse.json(
        {
          error: 'no_worldchain_offer',
          detail:
            'seller did not answer a 402 offering Worldchain USDC — it may be down, or it may settle on another rail',
          network: SETTLEMENT_NETWORK,
        },
        { status: 502 },
      )
    }
  }

  const [trust, window] = await Promise.all([sellerTrust(payTo), indexWindow()])

  return NextResponse.json({
    host: host ?? (url ? new URL(url).host : null),
    payTo,
    network: SETTLEMENT_NETWORK,
    priceUsd,
    // Absence of history is absence, not a bad score: this seller may predate our
    // startBlock or settle elsewhere. Callers must not read null as "untrustworthy".
    settledSinceDeployment: trust?.settlementCount ?? 0,
    uniquePayers: trust?.uniquePayerCount ?? 0,
    totalReceivedUsd: trust?.totalReceivedUsd ?? 0,
    firstSeenTimestamp: trust?.firstSeenTimestamp ?? null,
    lastSeenTimestamp: trust?.lastSeenTimestamp ?? null,
    // Single sortable number so a ranker (H1) can compose this with its own signals.
    // Deliberately crude: distinct payers dominate raw count, because N payments from one
    // address is cheap to manufacture and N payments from N addresses is not. It is an
    // ordering key, not a probability — do not render it as a score to a human.
    rankKey: (trust?.uniquePayerCount ?? 0) * 1000 + (trust?.settlementCount ?? 0),
    indexedSince: window
      ? {
          block: Number(window.firstIndexedBlock),
          timestamp: Number(window.firstIndexedTimestamp),
        }
      : null,
    source: 'the-graph:worldchain-usdc',
    note: 'Counts are USDC settlements on Worldchain since this subgraph was deployed — not lifetime history.',
  })
}
