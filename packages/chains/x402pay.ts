/**
 * x402 v2 payment wrapper (Base rail).
 *
 * ## Findings (spike S2, 2026-07-25)
 * - x402 v2 puts the offer in a base64 `payment-required` HTTP header on the 402;
 *   some sellers use a JSON body instead — `parse402` handles both.
 * - Amounts are atomic units of the asset (USDC = 6dp): "10000" → $0.01.
 * - Client API (verified against installed @x402/*@2.19.0, not docs):
 *   `wrapFetchWithPayment(fetch, new x402Client().register('eip155:8453',
 *   new ExactEvmScheme(viemAccount)))`; settlement receipt comes back base64 in the
 *   `PAYMENT-RESPONSE` header (fallback `X-PAYMENT-RESPONSE`), decoded with
 *   `decodePaymentResponseHeader`.
 * - `parse402` takes an optional pre-read body string instead of being async: the
 *   header path needs no body, and callers that already consumed the body can pass it.
 */
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm'
import { privateKeyToAccount } from 'viem/accounts'

export const BASE_NETWORK = 'eip155:8453'
const USDC_DECIMALS = 6

export interface Quote402 {
  amountUsd: number
  network: string
  asset: string
  payTo: string
  maxTimeoutSeconds?: number
  description?: string
  /** Bazaar extension: how to call the endpoint (input schema/params, output example). */
  bazaarInfo?: { input?: unknown; output?: unknown }
}

interface Accepts {
  scheme: string
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds?: number
}

/**
 * Parse an x402 v2 402 response into a quote. Reads the base64 `payment-required`
 * header first; falls back to `bodyText` (pass `await res.text()`) for sellers that
 * put the payload in the body. Returns null when no usable payload is found.
 */
export function parse402(res: Response, bodyText?: string): Quote402 | null {
  let payload: {
    accepts?: Accepts[]
    resource?: { description?: string }
    extensions?: { bazaar?: { info?: { input?: unknown; output?: unknown } } }
  } | null = null

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
  if (!payload?.accepts?.length) return null

  const accepts =
    payload.accepts.find((a) => a.network === BASE_NETWORK && a.scheme === 'exact') ??
    payload.accepts[0]

  return {
    amountUsd: Number(accepts.amount) / 10 ** USDC_DECIMALS,
    network: accepts.network,
    asset: accepts.asset,
    payTo: accepts.payTo,
    maxTimeoutSeconds: accepts.maxTimeoutSeconds,
    description: payload.resource?.description,
    bazaarInfo: payload.extensions?.bazaar?.info,
  }
}

/** Free GET: returns the seller's live quote without paying, or null if not an x402 endpoint. */
export async function probe(url: string, opts: { timeoutMs?: number } = {}): Promise<Quote402 | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      redirect: 'follow',
    })
    if (res.status !== 402) return null
    const bodyText = await res.text().catch(() => undefined)
    return parse402(res, bodyText)
  } catch {
    return null
  }
}

/**
 * Pay a 402 endpoint and return its data. Hard-gated: refuses unless MAINNET_PAY=true
 * and the live quote fits under maxUsd. Real-money path is exercised at T12, never before.
 */
export async function payAndFetch(
  url: string,
  walletKey: `0x${string}`,
  opts: { maxUsd: number; init?: RequestInit },
): Promise<{ data: unknown; paidUsd: number; txRef: string }> {
  const quote = await probe(url)
  if (!quote) throw new Error(`no x402 quote at ${url}`)
  if (quote.network !== BASE_NETWORK)
    throw new Error(`unsupported network ${quote.network} (only ${BASE_NETWORK})`)
  if (quote.amountUsd > opts.maxUsd)
    throw new Error(`live ask $${quote.amountUsd} exceeds maxUsd $${opts.maxUsd}`)
  if (process.env.MAINNET_PAY !== 'true')
    throw new Error('MAINNET_PAY!=true — real spends are gated off')

  const account = privateKeyToAccount(walletKey)
  const client = new x402Client().register(BASE_NETWORK, new ExactEvmScheme(account))
  const fetchWithPay = wrapFetchWithPayment(fetch, client)

  const res = await fetchWithPay(url, opts.init)
  if (!res.ok) throw new Error(`paid fetch failed: HTTP ${res.status}`)

  const receiptHeader =
    res.headers.get('payment-response') ?? res.headers.get('x-payment-response')
  let txRef = 'unknown'
  if (receiptHeader) {
    try {
      const receipt = decodePaymentResponseHeader(receiptHeader) as { transaction?: string }
      txRef = receipt.transaction ?? 'unknown'
    } catch {
      // settlement succeeded but receipt header was unreadable; keep 'unknown'
    }
  }

  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { data, paidUsd: quote.amountUsd, txRef }
}
