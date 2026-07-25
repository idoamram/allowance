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
export const WORLDCHAIN_NETWORK = 'eip155:480'
export const HEDERA_TESTNET_NETWORK = 'hedera:testnet'
const USDC_DECIMALS = 6
/** HBAR is quoted in tinybars, not a 6dp token. */
const TINYBAR = 1e8

/** CAIP-2 network for each rail in the product's vocabulary. */
export const NETWORK_FOR_RAIL: Record<string, string> = {
  worldchain: WORLDCHAIN_NETWORK,
  base: BASE_NETWORK,
  hedera: HEDERA_TESTNET_NETWORK,
}

/**
 * Rail preference when a seller offers several and the caller hasn't asked for one.
 * Sponsor rails first (2026-07-25 rails amendment), Base as the fallback that has depth.
 */
const RAIL_PREFERENCE = [HEDERA_TESTNET_NETWORK, WORLDCHAIN_NETWORK, BASE_NETWORK]

/** The fixed demo conversion, stated wherever an HBAR price is shown as dollars. */
export const usdPerHbar = (): number => Number(process.env.DEMO_USD_PER_HBAR ?? 0.07)

export interface Quote402 {
  amountUsd: number
  /** HBAR on the Hedera rail; undefined on EVM rails, where USD is already native. */
  amountNative?: number
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
export function parse402(
  res: Response,
  bodyText?: string,
  opts: { network?: string } = {},
): Quote402 | null {
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

  // A seller often offers many rails (Carbon & Cashmere lists seven). Honour the caller's
  // rail when it's on offer, then fall back to our sponsor-first preference order.
  const exact = payload.accepts.filter((a) => a.scheme === 'exact')
  const pool = exact.length > 0 ? exact : payload.accepts
  const accepts =
    (opts.network ? pool.find((a) => a.network === opts.network) : undefined) ??
    RAIL_PREFERENCE.map((n) => pool.find((a) => a.network === n)).find(Boolean) ??
    pool[0]

  // EVM rails quote USDC at 6dp, so the amount already IS dollars. Hedera quotes HBAR in
  // tinybars, which becomes dollars only through the fixed, stated demo rate.
  const isHedera = accepts.network.startsWith('hedera:')
  const amountUsd = isHedera
    ? Number(((Number(accepts.amount) / TINYBAR) * usdPerHbar()).toFixed(6))
    : Number(accepts.amount) / 10 ** USDC_DECIMALS

  return {
    amountUsd,
    amountNative: isHedera ? Number(accepts.amount) / TINYBAR : undefined,
    network: accepts.network,
    asset: accepts.asset,
    payTo: accepts.payTo,
    maxTimeoutSeconds: accepts.maxTimeoutSeconds,
    description: payload.resource?.description,
    bazaarInfo: payload.extensions?.bazaar?.info,
  }
}

/**
 * Free GET: returns the seller's live quote without paying, or null if not an x402
 * endpoint. `network` asks for a specific rail's offer when the seller lists several.
 */
export async function probe(
  url: string,
  opts: { timeoutMs?: number; network?: string } = {},
): Promise<Quote402 | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      redirect: 'follow',
    })
    if (res.status !== 402) return null
    const bodyText = await res.text().catch(() => undefined)
    return parse402(res, bodyText, { network: opts.network })
  } catch {
    return null
  }
}

export interface PayResult {
  data: unknown
  paidUsd: number
  txRef: string
  network: string
  payTo: string
}

export interface PayCredentials {
  /** EVM plan-wallet key — pays the Worldchain and Base rails. */
  evmKey?: `0x${string}`
  /** Hedera envelope account and its signers — pays the Hedera rail. */
  hedera?: {
    accountId: string
    /** Both signatures: the envelope's key is 2-of-2(agent, policy) under the outer 1-of. */
    sign: (transactionBase64: string) => Promise<string>
  }
}

/**
 * Pay a 402 endpoint and return its data.
 *
 * Two hard gates, both refusals rather than warnings: mainnet rails are dead unless
 * MAINNET_PAY=true, and no rail pays more than maxUsd. Hedera testnet is free money and
 * ungated — which is exactly why every flow is proven there first.
 */
export async function payAndFetch(
  url: string,
  credentials: PayCredentials | `0x${string}`,
  opts: { maxUsd: number; init?: RequestInit; network?: string },
): Promise<PayResult> {
  // Back-compat: a bare key means the EVM rail.
  const creds: PayCredentials = typeof credentials === 'string' ? { evmKey: credentials } : credentials

  const quote = await probe(url, { network: opts.network })
  if (!quote) throw new Error(`no x402 quote at ${url}`)
  if (opts.network && quote.network !== opts.network)
    throw new Error(`seller does not offer ${opts.network} (offers ${quote.network})`)
  if (quote.amountUsd > opts.maxUsd)
    throw new Error(`live ask $${quote.amountUsd} exceeds maxUsd $${opts.maxUsd}`)

  const isMainnetRail = quote.network === BASE_NETWORK || quote.network === WORLDCHAIN_NETWORK
  if (isMainnetRail && process.env.MAINNET_PAY !== 'true')
    throw new Error(`MAINNET_PAY!=true — real spends on ${quote.network} are gated off`)

  const caip2 = quote.network as `${string}:${string}`
  const client = new x402Client()
  if (quote.network.startsWith('hedera:')) {
    if (!creds.hedera) throw new Error('hedera rail needs an envelope signer')
    // The envelope account is the payer; the facilitator pays the fee, and that fee-payer
    // signature is what completes the threshold without the treasury ever signing (S1).
    const { ExactHederaScheme } = await import('@x402/hedera')
    const signer = {
      accountId: creds.hedera.accountId,
      createPartiallySignedTransferTransaction: (requirements: unknown) =>
        creds.hedera!.sign(JSON.stringify(requirements)),
    }
    client.register(caip2, new ExactHederaScheme(signer as never))
  } else {
    if (!creds.evmKey) throw new Error(`${quote.network} needs an EVM plan-wallet key`)
    client.register(caip2, new ExactEvmScheme(privateKeyToAccount(creds.evmKey)))
  }
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
  return {
    data,
    paidUsd: quote.amountUsd,
    txRef,
    network: quote.network,
    payTo: quote.payTo,
  }
}
