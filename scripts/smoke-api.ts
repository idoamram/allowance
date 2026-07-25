/**
 * End-to-end smoke test of the C3 API against a running server.
 * Reads the agent token from .env.local at runtime — the value is never printed.
 *
 * Usage: pnpm smoke [baseUrl]     (default http://localhost:3000)
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

const base = process.argv[2] ?? process.env.PLANBOUND_API_URL ?? 'http://localhost:3000'
const token = process.env.PLANBOUND_AGENT_TOKEN
if (!token) {
  console.error('blocked: PLANBOUND_AGENT_TOKEN missing — run `pnpm seed:agent` first')
  process.exit(1)
}

const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/** A crashed route answers with an empty or HTML body — say so instead of throwing. */
const json = async (res: Response): Promise<Record<string, any>> => {
  const text = await res.text()
  if (!text) return { error: `empty body (HTTP ${res.status})` }
  try {
    return JSON.parse(text)
  } catch {
    return { error: `non-JSON body (HTTP ${res.status}): ${text.slice(0, 200)}` }
  }
}

const plan = {
  goal: 'Vet 3 counterparty wallets before I pay them',
  approach: 'Screen every address for sanctions first, then price risk on the ones that clear',
  steps: [
    {
      serviceUrl: 'https://api.carbon-cashmere.de/v1/btc-derivatives/diversity',
      serviceName: 'Market diversity',
      quoteUsd: 0.02,
      source: 'live-402',
      buys: 'Derivatives concentration snapshot',
      why: 'A thin market means the risk score is not meaningful',
      rail: 'worldchain',
    },
    {
      serviceUrl: 'https://x402-endpoints.onrender.com/crypto/wallet-xray',
      serviceName: 'Wallet Risk X-Ray',
      quoteUsd: 0.05,
      source: 'live-402',
      buys: 'Balances, portfolio value and an OFAC flag per address',
      why: 'A sanctioned counterparty voids the rest of the vetting',
      rail: 'base',
    },
  ],
  ceilingUsd: 0.12,
  tolerancePct: 20,
  expiresInMin: 60,
  selfCheck: { turns: 2, fixes: ['dropped one dead endpoint', 'deduped two steps on the same host'] },
}

// 1. Submit
const created = await fetch(`${base}/api/mcp/plans`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify(plan),
})
const createdBody = await json(created)
check('POST /api/mcp/plans → 200', created.status === 200, createdBody.error ?? `planId ${createdBody.planId}`)
if (!createdBody.planId) process.exit(1)
const planId = createdBody.planId
const approvalKey = new URL(createdBody.approvalUrl!).searchParams.get('k')!

// 2. Auth is real
const noAuth = await fetch(`${base}/api/mcp/plans`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(plan),
})
check('unauthenticated submit → 401', noAuth.status === 401)

// 3. The money invariant is enforced server-side
const badCeiling = await fetch(`${base}/api/mcp/plans`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ ...plan, ceilingUsd: 0.01 }),
})
check('ceiling below total → 400', badCeiling.status === 400)

// 4. Read back
const fetched = await fetch(`${base}/api/mcp/plans/${planId}`, { headers: auth })
const plan2 = await json(fetched)
check('GET plan → pending_approval', plan2.status === 'pending_approval')
check('steps round-trip', plan2.steps?.length === 2, `total $${plan2.totalUsd}`)

// 5. A wrong approval key cannot decide
const wrongKey = await fetch(`${base}/api/plans/${planId}/decision?k=nope`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ outcome: 'approved' }),
})
check('decision with wrong key → 404', wrongKey.status === 404)

// 6. A rejection without a typed target is refused — the learning loop needs signal
const untyped = await fetch(`${base}/api/plans/${planId}/decision?k=${approvalKey}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ outcome: 'rejected' }),
})
check('untyped rejection → 400', untyped.status === 400)

// 7. The real approval
const approved = await fetch(`${base}/api/plans/${planId}/decision?k=${approvalKey}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ outcome: 'approved' }),
})
check('approve with key → 200', approved.status === 200)

const after = await json(await fetch(`${base}/api/mcp/plans/${planId}`, { headers: auth }))
check('plan is approved', after.status === 'approved')
check('decision recorded', after.decisions?.length === 1, after.decision?.outcome)

// 8. Double approval is refused
const again = await fetch(`${base}/api/plans/${planId}/decision?k=${approvalKey}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ outcome: 'approved' }),
})
check('second approval → 409', again.status === 409)

console.log(failures === 0 ? `\nSMOKE PASS (${planId})` : `\nSMOKE FAILED: ${failures}`)
process.exit(failures === 0 ? 0 : 1)
