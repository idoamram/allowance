/**
 * Spike S4 — an x402 payment settling on `hedera:testnet` end to end:
 *   seller (in-process, honestly ours — no Hedera x402 market exists) charges 0.5 ℏ
 *   for a real service (live HBAR exchange rate from the mirror node); Blocky402's
 *   hosted facilitator verifies + settles; the buyer pays via ExactHederaScheme.
 *   Merchant credit is then verified on the mirror node.
 *
 * Facilitator: https://api.testnet.blocky402.com (POST /verify, /settle, GET /supported;
 * fee payer from /supported — the "payer outside the envelope key" S1 proved we need).
 *
 * ## Findings (run 2026-07-25 ~22:50, PASS first try — Flow A is real)
 * - Blocky402 hosted testnet facilitator works keyless end to end: GET /supported →
 *   `{scheme:'exact', network:'hedera:testnet', extra:{feePayer:'0.0.7162784'}}`;
 *   POST /verify → `{isValid, payer}`; POST /settle → `{success, transaction, payer}`.
 *   Body for both: `{x402Version:2, paymentPayload, paymentRequirements}`.
 * - v2 header trio confirmed on-wire: seller sends `payment-required` (b64), buyer
 *   sends `payment-signature`, seller returns `payment-response` with the settle result.
 * - HBAR is asset `'0.0.0'`, amounts in tinybars ('50000000' = 0.5 ℏ). Settlement tx id
 *   belongs to the FACILITATOR's fee payer (`0.0.7162784@…`) — receipts must record
 *   both that tx id and the payer account.
 * - Buyer stack is the standard one: createClientHederaSigner(accountId, PrivateKey) →
 *   ExactHederaScheme → x402Client.register('hedera:testnet') → wrapFetchWithPayment.
 *   T9's graduation: a custom ClientHederaSigner whose
 *   createPartiallySignedTransferTransaction signs with agent+policy for the ENVELOPE
 *   account — the facilitator is the external payer S1 proved completes the threshold.
 * - Friction (also in docs/feedback/x402-hedera.md): @x402/hedera bundles its own
 *   @hiero-ledger/sdk instance → nominal PrivateKey type mismatch at the boundary.
 */
import { createServer } from 'node:http'
import { config } from 'dotenv'
import { AccountCreateTransaction, Client, Hbar } from '@hiero-ledger/sdk'
import { ExactHederaScheme, createClientHederaSigner } from '@x402/hedera'
import { wrapFetchWithPayment, x402Client } from '@x402/fetch'
import { need, parseKey, resolveAccountKey } from './hedera-keys'

config({ path: '.env.local' })

const FACILITATOR = 'https://api.testnet.blocky402.com'
const MIRROR = 'https://testnet.mirrornode.hedera.com'
const NETWORK = 'hedera:testnet'
const PORT = 4402
const PRICE_TINYBAR = '50000000' // 0.5 ℏ

const operatorId = need('HEDERA_OPERATOR_ID')
const operatorKey = await resolveAccountKey(operatorId, need('HEDERA_OPERATOR_KEY'))
const policyKey = parseKey('HEDERA_POLICY_KEY', need('HEDERA_POLICY_KEY'))
const client = Client.forTestnet().setOperator(operatorId, operatorKey)

// Fee payer comes from the facilitator itself — never hardcoded.
const supported = (await (await fetch(`${FACILITATOR}/supported`)).json()) as {
  kinds: { scheme: string; network: string; extra?: { feePayer?: string } }[]
}
const hederaKind = supported.kinds.find((k) => k.network === NETWORK && k.scheme === 'exact')
if (!hederaKind?.extra?.feePayer) {
  console.error(`S4 blocked: facilitator no longer lists exact/${NETWORK}`)
  process.exit(1)
}
const feePayer = hederaKind.extra.feePayer
console.log(`1. facilitator live: exact/${NETWORK}, feePayer ${feePayer}`)

// Merchant account (receiver) — fresh, zero balance, policy key.
const merchantRx = await (
  await new AccountCreateTransaction()
    .setKeyWithoutAlias(policyKey.publicKey)
    .setInitialBalance(new Hbar(0))
    .execute(client)
).getReceipt(client)
const merchantId = merchantRx.accountId!.toString()
console.log(`2. merchant account created: ${merchantId} (0 ℏ)`)

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64')
const unb64 = (s: string) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'))

const requirements = {
  scheme: 'exact',
  network: NETWORK,
  amount: PRICE_TINYBAR,
  asset: '0.0.0', // HBAR
  payTo: merchantId,
  maxTimeoutSeconds: 120,
  extra: { feePayer },
}

// 3. Seller — minimal but protocol-correct v2 resource server.
const seller = createServer(async (req, res) => {
  try {
    if (!req.url?.startsWith('/rate-brief')) {
      res.writeHead(404).end()
      return
    }
    const sig = req.headers['payment-signature']
    if (!sig || typeof sig !== 'string') {
      res.writeHead(402, {
        'payment-required': b64({
          x402Version: 2,
          resource: {
            url: `http://127.0.0.1:${PORT}/rate-brief`,
            description: 'Live HBAR/USD exchange rate brief from the Hedera mirror node',
            mimeType: 'application/json',
          },
          accepts: [requirements],
        }),
        'content-type': 'application/json',
      })
      res.end(JSON.stringify({ error: 'payment required' }))
      return
    }
    const paymentPayload = unb64(sig)
    const fBody = JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: requirements })
    const fHeaders = { 'content-type': 'application/json' }
    const verify = await (await fetch(`${FACILITATOR}/verify`, { method: 'POST', headers: fHeaders, body: fBody })).json()
    console.log('   seller: /verify →', JSON.stringify(verify).slice(0, 140))
    if (!(verify as { isValid?: boolean }).isValid) {
      res.writeHead(402, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'verify failed', verify }))
      return
    }
    const settle = await (await fetch(`${FACILITATOR}/settle`, { method: 'POST', headers: fHeaders, body: fBody })).json()
    console.log('   seller: /settle →', JSON.stringify(settle).slice(0, 140))
    if (!(settle as { success?: boolean }).success) {
      res.writeHead(402, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'settle failed', settle }))
      return
    }
    const rate = await (await fetch(`${MIRROR}/api/v1/network/exchangerate`)).json()
    res.writeHead(200, { 'content-type': 'application/json', 'payment-response': b64(settle) })
    res.end(JSON.stringify({ service: 'rate-brief', rate }))
  } catch (err) {
    console.error('   seller error:', err)
    res.writeHead(500).end()
  }
})
await new Promise<void>((r) => seller.listen(PORT, '127.0.0.1', r))
console.log(`3. seller listening on :${PORT} (0.5 ℏ per call, payTo ${merchantId})`)

// 4. Buyer — operator pays through the standard x402 client stack.
// Cast: @x402/hedera bundles its own @hiero-ledger/sdk instance, so PrivateKey is
// nominally incompatible across the two copies while being the same class at runtime.
const signer = createClientHederaSigner(operatorId, operatorKey as never)
const payClient = new x402Client().register(NETWORK, new ExactHederaScheme(signer))
const fetchWithPay = wrapFetchWithPayment(fetch, payClient)
const paid = await fetchWithPay(`http://127.0.0.1:${PORT}/rate-brief`)
console.log(`4. buyer paid fetch → HTTP ${paid.status}`)
const body = await paid.json()
console.log('   data:', JSON.stringify(body).slice(0, 160))
const receiptHeader = paid.headers.get('payment-response')
const receipt = receiptHeader ? (unb64(receiptHeader) as { transaction?: string }) : null
console.log('   settle receipt tx:', receipt?.transaction ?? 'n/a')

// 5. Mirror-node proof: merchant got the 0.5 ℏ.
await new Promise((r) => setTimeout(r, 6000))
const merchant = (await (await fetch(`${MIRROR}/api/v1/accounts/${merchantId}`)).json()) as {
  balance?: { balance?: number }
}
const got = (merchant.balance?.balance ?? 0) / 1e8
console.log(`5. merchant balance on mirror node: ${got} ℏ`)

const pass = paid.status === 200 && got >= 0.5
console.log(pass ? 'S4 PASS: x402 settled on hedera:testnet end to end' : 'S4 FAIL — see logs above')
seller.close()
client.close()
process.exit(pass ? 0 : 1)
