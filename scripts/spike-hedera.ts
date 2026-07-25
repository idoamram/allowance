/**
 * Spike S1 — proves the envelope primitive end to end on Hedera testnet:
 *   1. Account with nested threshold key 1-of-[2-of-2(agent, policy), treasury]
 *   2. Transfer out co-signed by agent+policy → SUCCESS
 *   3. Transfer signed by agent alone → INVALID_SIGNATURE
 *   4. ScheduleCreate full-refund with waitForExpiry → executes at expiry, keeperless
 *
 * Needs in .env.local: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY (treasury),
 * HEDERA_POLICY_KEY, AGENT_EVM_KEY (both via `pnpm keygen`).
 *
 * ## Findings (run 2026-07-25 ~22:30, testnet — all four claims CONFIRMED)
 * - Raw 64-hex private keys are algorithm-ambiguous (parse as both ED25519 and ECDSA);
 *   the wrong guess fails precheck INVALID_SIGNATURE (status 7). Resolve the algorithm
 *   AND verify the derived public key against the mirror node (public data) before any
 *   transaction — `resolveOperatorKey` below is the pattern T7 must reuse.
 * - **The fee payer's signature counts toward the paid-from account's key threshold.**
 *   Treasury-as-payer satisfied the outer 1-of on its own — so the control plane gets
 *   the reclaim path "for free", and dual-control is only meaningful with a payer from
 *   OUTSIDE the envelope key. That payer is exactly the x402 facilitator topology; the
 *   spike uses a throwaway relayer to stand in for it.
 * - Nested KeyList (1-of-[2-of-2(agent,policy), treasury], ECDSA) via
 *   setKeyWithoutAlias: agent+policy → SUCCESS; agent alone → receipt INVALID_SIGNATURE.
 * - ScheduleCreate(fixed transfer) + setExpirationTime(+2min) + setWaitForExpiry(true),
 *   treasury signing at create: executed exactly at expiry, keeperless — envelope went
 *   3.5 → 0.5 ℏ with no further action, confirmed on consensus and mirror node. Fixed
 *   amounts only: the 0.5 remainder needs the treasury sweep, exactly as latest.md says.
 */
import 'dotenv/config'
import { config } from 'dotenv'
import {
  AccountBalanceQuery,
  AccountCreateTransaction,
  Client,
  Hbar,
  KeyList,
  PrivateKey,
  ScheduleCreateTransaction,
  Timestamp,
  TransferTransaction,
} from '@hiero-ledger/sdk'

config({ path: '.env.local' })

const need = (name: string): string => {
  const v = process.env[name]
  if (!v) {
    console.error(`S1 blocked: ${name} missing from .env.local`)
    process.exit(1)
  }
  return v
}

/** Portal keys come as DER or raw hex, ECDSA or ED25519 — try each without printing anything. */
const parseKey = (name: string, raw: string): PrivateKey => {
  let s = raw.trim().replace(/^['"]|['"]$/g, '')
  if (s.toLowerCase().startsWith('0x')) s = s.slice(2)
  for (const parse of [
    () => PrivateKey.fromStringDer(s),
    () => PrivateKey.fromStringECDSA(s),
    () => PrivateKey.fromStringED25519(s),
  ]) {
    try {
      return parse()
    } catch {
      /* next */
    }
  }
  // Shape diagnostics only — structural facts, never key material.
  const shape = {
    length: s.length,
    hexOnly: /^[0-9a-fA-F]+$/.test(s),
    derEd25519Header: s.startsWith('302e'),
    derEcdsaHeader: s.startsWith('3030'),
    looksLikeDerPUBLICKey: s.startsWith('302a') || s.startsWith('302d'),
    hasWhitespaceInside: /\s/.test(s),
  }
  console.error(`S1 blocked: could not parse ${name}. Shape: ${JSON.stringify(shape)}`)
  console.error('Expected: 64-char raw hex, or DER (302e.../3030...), with or without 0x.')
  process.exit(1)
}

const operatorId = need('HEDERA_OPERATOR_ID')

/**
 * A raw 64-hex private key is ambiguous (parses as both ED25519 and ECDSA), and signing
 * with the wrong algorithm fails precheck with INVALID_SIGNATURE. The account's key TYPE
 * and public key are public mirror-node data — resolve the algorithm from there and
 * verify the derived public key matches before any transaction.
 */
const resolveOperatorKey = async (accountId: string, raw: string): Promise<PrivateKey> => {
  const res = await fetch(
    `https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`,
  )
  if (!res.ok) {
    console.error(`S1 blocked: mirror node has no account ${accountId} (HTTP ${res.status}) — is the ID right / is it testnet?`)
    process.exit(1)
  }
  const info = (await res.json()) as { key?: { _type?: string; key?: string } }
  const keyType = info.key?._type ?? ''
  const onChainPub = (info.key?.key ?? '').toLowerCase()
  let s = raw.trim().replace(/^['"]|['"]$/g, '')
  if (s.toLowerCase().startsWith('0x')) s = s.slice(2)

  const candidates: PrivateKey[] = []
  for (const parse of [
    () => PrivateKey.fromStringDer(s),
    () => (keyType.includes('ED25519') ? PrivateKey.fromStringED25519(s) : PrivateKey.fromStringECDSA(s)),
    () => (keyType.includes('ED25519') ? PrivateKey.fromStringECDSA(s) : PrivateKey.fromStringED25519(s)),
  ]) {
    try {
      candidates.push(parse())
    } catch {
      /* next */
    }
  }
  for (const k of candidates) {
    if (k.publicKey.toStringRaw().toLowerCase() === onChainPub) {
      console.log(`operator key resolved: ${keyType}, public key matches mirror node`)
      return k
    }
  }
  console.error(
    `S1 blocked: HEDERA_OPERATOR_KEY does not correspond to account ${accountId}.\n` +
      `Mirror node says the account key is ${keyType || 'unknown'} with public key ${onChainPub.slice(0, 16)}…\n` +
      `The pasted private key derives a different public key — likely a key from another account.`,
  )
  process.exit(1)
}

const operatorKey = await resolveOperatorKey(operatorId, need('HEDERA_OPERATOR_KEY'))
const policyKey = parseKey('HEDERA_POLICY_KEY', need('HEDERA_POLICY_KEY'))
const agentKey = parseKey('AGENT_EVM_KEY', need('AGENT_EVM_KEY'))

const client = Client.forTestnet().setOperator(operatorId, operatorKey)

// 1. Envelope account: 1-of-[ 2-of-2(agent, policy), treasury ]
const dualControl = new KeyList([agentKey.publicKey, policyKey.publicKey], 2)
const envelopeKey = new KeyList([dualControl, operatorKey.publicKey], 1)

const createRx = await (
  await new AccountCreateTransaction()
    .setKeyWithoutAlias(envelopeKey)
    .setInitialBalance(new Hbar(5))
    .execute(client)
).getReceipt(client)
const envelopeId = createRx.accountId!
console.log(`1. envelope account created: ${envelopeId.toString()} (5 hbar, nested threshold key)`)

// FINDING (first run): the fee payer's signature counts toward the account key
// threshold. With treasury as payer, ANY transfer satisfied the outer 1-of — so
// dual-control must be exercised through a payer that is NOT in the envelope key.
// That payer is exactly what the x402 facilitator is. A throwaway relayer plays it.
const relayerKey = PrivateKey.generateECDSA()
const relayerRx = await (
  await new AccountCreateTransaction()
    .setKeyWithoutAlias(relayerKey.publicKey)
    .setInitialBalance(new Hbar(2))
    .execute(client)
).getReceipt(client)
const relayerId = relayerRx.accountId!
const relayerClient = Client.forTestnet().setOperator(relayerId, relayerKey)
console.log(`   relayer (facilitator stand-in) created: ${relayerId.toString()}`)

// 2. Co-signed transfer out (agent + policy, relayer pays — no treasury sig anywhere)
const coSigned = await new TransferTransaction()
  .addHbarTransfer(envelopeId, new Hbar(-1))
  .addHbarTransfer(operatorId, new Hbar(1))
  .freezeWith(relayerClient)
const coSignedRx = await (
  await (await (await coSigned.sign(agentKey)).sign(policyKey)).execute(relayerClient)
).getReceipt(relayerClient)
console.log(`2. agent+policy co-signed 1 hbar out (relayer payer): ${coSignedRx.status.toString()}`)

// 3. Agent alone via relayer → must be rejected
try {
  const solo = await new TransferTransaction()
    .addHbarTransfer(envelopeId, new Hbar(-1))
    .addHbarTransfer(operatorId, new Hbar(1))
    .freezeWith(relayerClient)
  await (await (await solo.sign(agentKey)).execute(relayerClient)).getReceipt(relayerClient)
  console.error('3. FAIL: agent-alone transfer was ACCEPTED — key structure is wrong')
  process.exit(1)
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  console.log(`3. agent-alone transfer rejected as expected: ${msg.slice(0, 110)}`)
}

// 3b. Treasury path (treasury as payer auto-signs): reclaim works by design
const reclaim = await new TransferTransaction()
  .addHbarTransfer(envelopeId, new Hbar(-0.5))
  .addHbarTransfer(operatorId, new Hbar(0.5))
  .freezeWith(client)
const reclaimRx = await (await reclaim.execute(client)).getReceipt(client)
console.log(`3b. treasury reclaim path (payer sig satisfies 1-of): ${reclaimRx.status.toString()}`)

// 4. Keeperless refund: schedule a fixed transfer, waitForExpiry, treasury path signs now
const expiry = Timestamp.fromDate(new Date(Date.now() + 120_000))
const refund = new TransferTransaction()
  .addHbarTransfer(envelopeId, new Hbar(-3))
  .addHbarTransfer(operatorId, new Hbar(3))
const scheduleRx = await (
  await new ScheduleCreateTransaction()
    .setScheduledTransaction(refund)
    .setExpirationTime(expiry)
    .setWaitForExpiry(true)
    .execute(client)
).getReceipt(client)
console.log(`4. refund scheduled: ${scheduleRx.scheduleId!.toString()} — executes at expiry (~2 min)`)

const before = await new AccountBalanceQuery().setAccountId(envelopeId).execute(client)
console.log(`   envelope balance before expiry: ${before.hbars.toString()}`)

console.log('   waiting 150s for expiry execution...')
await new Promise((r) => setTimeout(r, 150_000))

const after = await new AccountBalanceQuery().setAccountId(envelopeId).execute(client)
console.log(`   envelope balance after expiry:  ${after.hbars.toString()}`)

// Cross-check on the mirror node (public, indexed a few seconds behind consensus)
await new Promise((r) => setTimeout(r, 5_000))
const mirror = (await (
  await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${envelopeId.toString()}`)
).json()) as { balance?: { balance?: number } }
console.log(`   mirror node balance: ${(mirror.balance?.balance ?? 0) / 1e8} hbar`)

const refunded = after.hbars.toBigNumber().toNumber() < 1.5
console.log(
  refunded
    ? 'S1 PASS: envelope + dual-control + keeperless refund all confirmed'
    : 'S1 PARTIAL: schedule did not execute at expiry — check schedule info',
)
relayerClient.close()
client.close()
process.exit(refunded ? 0 : 1)
