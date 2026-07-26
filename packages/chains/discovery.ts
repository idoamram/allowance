/**
 * x402 Bazaar discovery + live quoting (production code, born in spike S3).
 *
 * ## Findings (2026-07-25)
 * - Bazaar search is keyless and free: GET .../v2/x402/discovery/search?query=&limit=.
 *   Each resource: `resource` (URL), `serviceName`, `description`, `accepts[]`,
 *   `quality` {l30DaysTotalCalls, l30DaysUniquePayers}, `extensions.bazaar.info.input`.
 * - Classification in quoteSteps: live 402 → 'live-402' with the probed amount;
 *   reachable-but-no-402 (param-gated sellers) → 'estimate' from the listed price;
 *   unreachable or priceless → dropped and logged. The estimate path is what the
 *   drift gate later protects.
 */
import { BASE_NETWORK, probe as liveProbe, type Quote402 } from './x402pay'

const BAZAAR = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery'
const USDC_DECIMALS = 6

export interface Candidate {
  url: string
  name: string
  priceUsd: number | null
  network: string
  description: string
  inputSchema?: unknown
  /** Bazaar 30-day usage — a crude liveness/trust prior until H3's subgraph ranking. */
  calls30d?: number
}

export type QuotedStep = Candidate & {
  quoteUsd: number
  source: 'live-402' | 'estimate'
}

interface BazaarResource {
  resource?: string
  serviceName?: string
  description?: string
  accepts?: { scheme: string; network: string; amount?: string }[]
  quality?: { l30DaysTotalCalls?: number }
  extensions?: { bazaar?: { info?: { input?: unknown } } }
}

const toCandidate = (r: BazaarResource, network: string): Candidate | null => {
  if (!r.resource?.startsWith('http')) return null
  const entry = r.accepts?.find((a) => a.network === network && a.scheme === 'exact')
  if (!entry) return null
  return {
    url: r.resource,
    name: r.serviceName ?? new URL(r.resource).hostname,
    priceUsd: entry.amount != null ? Number(entry.amount) / 10 ** USDC_DECIMALS : null,
    network,
    description: r.description ?? '',
    inputSchema: r.extensions?.bazaar?.info?.input,
    calls30d: r.quality?.l30DaysTotalCalls,
  }
}

/**
 * Search the Bazaar for sellers matching a task query. Free, keyless.
 * `opts.network` (CAIP-2, default Base) is passed to the Bazaar as a hard filter AND
 * applied to accepts[] — semantic search alone won't surface rail-specific sellers.
 */
export async function discover(
  query: string,
  opts: { maxUsdPrice?: number; limit?: number; network?: string } = {},
): Promise<Candidate[]> {
  const limit = opts.limit ?? 10
  const network = opts.network ?? BASE_NETWORK
  const netParam = `&network=${encodeURIComponent(network)}`
  const urls = [
    `${BAZAAR}/search?query=${encodeURIComponent(query)}&limit=${limit}${netParam}`,
    `${BAZAAR}/resources?limit=${limit}${netParam}`, // fallback: unfiltered listing
  ]
  for (const u of urls) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) continue
      const body = (await res.json()) as { resources?: BazaarResource[] }
      const candidates = (body.resources ?? [])
        .map((r) => toCandidate(r, network))
        .filter((c): c is Candidate => c !== null)
        .filter((c) => opts.maxUsdPrice == null || c.priceUsd == null || c.priceUsd <= opts.maxUsdPrice)
      if (candidates.length > 0) return candidates.slice(0, limit)
    } catch {
      // fall through to the next source
    }
  }
  return []
}

/** Any HTTP answer counts as reachable — sellers often 400/405 an unpaid bare GET. */
async function isReachableDefault(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(6000) })
    return true
  } catch {
    return false
  }
}

export interface QuoteDeps {
  probe: (url: string) => Promise<Quote402 | null>
  isReachable: (url: string) => Promise<boolean>
}

/**
 * Turn candidates into priced steps: probe each for a live 402 quote, fall back to
 * the Bazaar-listed price as an estimate, drop what's dead or priceless (logged).
 *
 * A live 402 overrides the Bazaar's `network` as well as its price. The directory says
 * what a seller *claims* to accept; the 402 is the seller answering for itself, right
 * now. Where they disagree the 402 wins — trusting the directory produced plans that
 * told a human "worldchain" for sellers that only settle on Base, and the payment failed
 * at the rail check after the envelope was already funded.
 *
 * The price and the rail come from the same response for the same reason: a quote is
 * only meaningful together with the chain it settles on.
 */
export async function quoteSteps(
  candidates: Candidate[],
  deps: QuoteDeps = { probe: liveProbe, isReachable: isReachableDefault },
): Promise<QuotedStep[]> {
  const quoted = await Promise.all(
    candidates.map(async (c): Promise<QuotedStep | null> => {
      const quote = await deps.probe(c.url)
      if (quote) {
        if (quote.network !== c.network) {
          console.warn(
            `[discovery] ${c.url}: Bazaar says ${c.network}, seller's 402 says ${quote.network} — using the seller's`,
          )
        }
        return { ...c, network: quote.network, quoteUsd: quote.amountUsd, source: 'live-402' }
      }
      if (c.priceUsd !== null && (await deps.isReachable(c.url)))
        return { ...c, quoteUsd: c.priceUsd, source: 'estimate' }
      console.warn(`[discovery] dropped ${c.url} (dead or priceless)`)
      return null
    }),
  )
  return quoted.filter((s): s is QuotedStep => s !== null)
}
