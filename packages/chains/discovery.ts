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

const toCandidate = (r: BazaarResource): Candidate | null => {
  if (!r.resource?.startsWith('http')) return null
  const base = r.accepts?.find((a) => a.network === BASE_NETWORK && a.scheme === 'exact')
  if (!base) return null
  return {
    url: r.resource,
    name: r.serviceName ?? new URL(r.resource).hostname,
    priceUsd: base.amount != null ? Number(base.amount) / 10 ** USDC_DECIMALS : null,
    network: BASE_NETWORK,
    description: r.description ?? '',
    inputSchema: r.extensions?.bazaar?.info?.input,
    calls30d: r.quality?.l30DaysTotalCalls,
  }
}

/** Search the Bazaar for Base-mainnet sellers matching a task query. Free, keyless. */
export async function discover(
  query: string,
  opts: { maxUsdPrice?: number; limit?: number } = {},
): Promise<Candidate[]> {
  const limit = opts.limit ?? 10
  const urls = [
    `${BAZAAR}/search?query=${encodeURIComponent(query)}&limit=${limit}`,
    `${BAZAAR}/resources?limit=${limit}`, // fallback: unfiltered listing
  ]
  for (const u of urls) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) continue
      const body = (await res.json()) as { resources?: BazaarResource[] }
      const candidates = (body.resources ?? [])
        .map(toCandidate)
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
 */
export async function quoteSteps(
  candidates: Candidate[],
  deps: QuoteDeps = { probe: liveProbe, isReachable: isReachableDefault },
): Promise<QuotedStep[]> {
  const quoted = await Promise.all(
    candidates.map(async (c): Promise<QuotedStep | null> => {
      const quote = await deps.probe(c.url)
      if (quote) return { ...c, quoteUsd: quote.amountUsd, source: 'live-402' }
      if (c.priceUsd !== null && (await deps.isReachable(c.url)))
        return { ...c, quoteUsd: c.priceUsd, source: 'estimate' }
      console.warn(`[discovery] dropped ${c.url} (dead or priceless)`)
      return null
    }),
  )
  return quoted.filter((s): s is QuotedStep => s !== null)
}
