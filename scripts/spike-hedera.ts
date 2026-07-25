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
 * ## Findings — filled in after the run (S1.6)
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
const parseKey = (raw: string): PrivateKey => {
  const s = raw.startsWith('0x') ? raw.slice(2) : raw
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
  console.error('S1 blocked: could not parse a private key from env (DER/ECDSA/ED25519 all failed)')
  process.exit(1)
}

const operatorId = need('HEDERA_OPERATOR_ID')
const operatorKey = parseKey(need('HEDERA_OPERATOR_KEY'))
const policyKey = parseKey(need('HEDERA_POLICY_KEY'))
const agentKey = parseKey(need('AGENT_EVM_KEY'))

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

// 2. Co-signed transfer out (agent + policy) → SUCCESS
const coSigned = await new TransferTransaction()
  .addHbarTransfer(envelopeId, new Hbar(-1))
  .addHbarTransfer(operatorId, new Hbar(1))
  .freezeWith(client)
const coSignedRx = await (
  await (await (await coSigned.sign(agentKey)).sign(policyKey)).execute(client)
).getReceipt(client)
console.log(`2. agent+policy co-signed 1 hbar out: ${coSignedRx.status.toString()}`)

// 3. Agent alone → must be rejected
try {
  const solo = await new TransferTransaction()
    .addHbarTransfer(envelopeId, new Hbar(-1))
    .addHbarTransfer(operatorId, new Hbar(1))
    .freezeWith(client)
  await (await (await solo.sign(agentKey)).execute(client)).getReceipt(client)
  console.error('3. FAIL: single-sig transfer was ACCEPTED — key structure is wrong')
  process.exit(1)
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  console.log(`3. agent-alone transfer rejected as expected: ${msg.slice(0, 120)}`)
}

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
client.close()
