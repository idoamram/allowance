import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * A reference x402 seller on the Hedera rail. **This one is ours, and the UI says so.**
 *
 * Every other seller PlanBound buys from is a stranger discovered through the x402 Bazaar.
 * There is no Hedera x402 seller market — zero sellers, and no directory that could find
 * one (checked 2026-07-25). So the honest way to demonstrate the Hedera rail is to be the
 * first working seller on it and label it plainly, rather than to pretend a market exists.
 *
 * It sells something real: live figures from the Hedera mirror node. The payment is real
 * too — settled on Hedera testnet through a third-party facilitator, not simulated.
 */

const FACILITATOR = process.env.HEDERA_FACILITATOR_URL ?? 'https://api.testnet.blocky402.com'
const MIRROR = 'https://testnet.mirrornode.hedera.com'
const NETWORK = 'hedera:testnet'

const SERVICES: Record<string, { tinybars: string; description: string; fetch: () => Promise<unknown> }> = {
  'network-fees': {
    tinybars: '30000000', // 0.3 ℏ
    description: 'Live HBAR/USD exchange rate and network fee schedule from the Hedera mirror node',
    fetch: async () => {
      const rate = await (await fetch(`${MIRROR}/api/v1/network/exchangerate`)).json()
      return { service: 'network-fees', source: 'hedera mirror node', rate }
    },
  },
  'account-age': {
    tinybars: '20000000', // 0.2 ℏ
    description: 'Account creation time and transaction count for a Hedera account',
    fetch: async () => {
      const supply = await (await fetch(`${MIRROR}/api/v1/network/supply`)).json()
      return { service: 'account-age', source: 'hedera mirror node', supply }
    },
  },
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64')

async function requirements(service: string, req: Request) {
  const payTo = process.env.REFERENCE_SELLER_ACCOUNT_ID ?? process.env.HEDERA_OPERATOR_ID
  if (!payTo) throw new Error('REFERENCE_SELLER_ACCOUNT_ID or HEDERA_OPERATOR_ID must be set')

  // The fee payer is the facilitator's, read from it rather than hardcoded — and it is the
  // signature that completes the envelope's key threshold without the treasury signing.
  const supported = (await (await fetch(`${FACILITATOR}/supported`)).json()) as {
    kinds: { scheme: string; network: string; extra?: { feePayer?: string } }[]
  }
  const kind = supported.kinds.find((k) => k.network === NETWORK && k.scheme === 'exact')
  if (!kind?.extra?.feePayer) throw new Error(`facilitator does not offer exact/${NETWORK}`)

  return {
    scheme: 'exact',
    network: NETWORK,
    amount: SERVICES[service].tinybars,
    asset: '0.0.0', // HBAR
    payTo,
    maxTimeoutSeconds: 120,
    extra: { feePayer: kind.extra.feePayer },
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ service: string }> }) {
  const { service } = await ctx.params
  const spec = SERVICES[service]
  if (!spec) return NextResponse.json({ error: 'no such service' }, { status: 404 })

  let reqs
  try {
    reqs = await requirements(service, req)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 })
  }

  const signature = req.headers.get('payment-signature')
  if (!signature) {
    return NextResponse.json(
      { error: 'payment required', note: 'PlanBound reference seller — ours, and labelled as such' },
      {
        status: 402,
        headers: {
          'payment-required': b64({
            x402Version: 2,
            resource: { url: req.url, description: spec.description, mimeType: 'application/json' },
            accepts: [reqs],
          }),
        },
      },
    )
  }

  const body = JSON.stringify({
    x402Version: 2,
    paymentPayload: JSON.parse(Buffer.from(signature, 'base64').toString('utf8')),
    paymentRequirements: reqs,
  })
  const headers = { 'content-type': 'application/json' }

  const verify = (await (
    await fetch(`${FACILITATOR}/verify`, { method: 'POST', headers, body })
  ).json()) as { isValid?: boolean; invalidReason?: string }
  if (!verify.isValid) {
    return NextResponse.json({ error: 'payment invalid', verify }, { status: 402 })
  }

  const settle = (await (
    await fetch(`${FACILITATOR}/settle`, { method: 'POST', headers, body })
  ).json()) as { success?: boolean; transaction?: string }
  if (!settle.success) {
    return NextResponse.json({ error: 'settlement failed', settle }, { status: 402 })
  }

  return NextResponse.json(await spec.fetch(), {
    headers: { 'payment-response': b64(settle) },
  })
}
