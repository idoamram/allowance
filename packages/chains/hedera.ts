/**
 * Hedera envelope operations — the enforcement rail.
 *
 * The envelope is a funded account whose key is `1-of-[ 2-of-2(agent, policy), treasury ]`:
 * the agent alone cannot spend, agent+policy can, and the treasury can always reclaim.
 * Consensus enforces the cap because the money simply isn't there to exceed.
 *
 * Two findings from spike S1 (2026-07-25) are load-bearing here, and both are easy to
 * get wrong:
 *
 *  1. **The fee payer's signature counts toward the paid-from account's key threshold.**
 *     A transfer *paid for* by the treasury satisfies the outer 1-of on its own. That is
 *     why `sweepEnvelope` needs no extra signatures — and why dual-control spending must
 *     be paid for by someone outside the envelope key (the x402 facilitator, at T9).
 *     Never "simplify" a dual-control transfer by paying its fee from the treasury.
 *
 *  2. **Raw 64-hex private keys are algorithm-ambiguous** (ED25519 vs ECDSA); the wrong
 *     guess fails at precheck with INVALID_SIGNATURE, which reads like a permissions bug.
 *     Resolve the algorithm against the account's public mirror-node record.
 */
import {
  AccountBalanceQuery,
  AccountCreateTransaction,
  Client,
  Hbar,
  KeyList,
  PrivateKey,
  PublicKey,
  ScheduleCreateTransaction,
  Timestamp,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransactionId,
  TransferTransaction,
} from '@hiero-ledger/sdk'

export type HcsEvent = 'plan' | 'approval' | 'receipt' | 'drift' | 'sweep'

const MIRROR: Record<string, string> = {
  testnet: 'https://testnet.mirrornode.hedera.com',
  mainnet: 'https://mainnet-public.mirrornode.hedera.com',
}

const env = (name: string): string => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set (see .env.example)`)
  return v
}

const network = () => process.env.HEDERA_NETWORK ?? 'testnet'
export const mirrorBase = () => MIRROR[network()] ?? MIRROR.testnet

/** USD is the product's unit; HBAR is the chain's. One fixed, stated demo rate between them. */
export const usdPerHbar = (): number => Number(process.env.DEMO_USD_PER_HBAR ?? 0.07)
export const usdToHbar = (usd: number): number => Number((usd / usdPerHbar()).toFixed(8))
export const hbarToUsd = (hbar: number): number => Number((hbar * usdPerHbar()).toFixed(6))

/**
 * Parse a private key whose algorithm is unknown, verifying it against the account's
 * on-chain public key. See finding (2) above.
 */
export async function resolveAccountKey(accountId: string, raw: string): Promise<PrivateKey> {
  const res = await fetch(`${mirrorBase()}/api/v1/accounts/${accountId}`)
  if (!res.ok) throw new Error(`mirror node has no account ${accountId} (HTTP ${res.status})`)
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
  const match = candidates.find((k) => k.publicKey.toStringRaw().toLowerCase() === onChainPub)
  if (!match) {
    throw new Error(
      `the configured key does not correspond to account ${accountId} ` +
        `(mirror reports ${keyType || 'unknown'})`,
    )
  }
  return match
}

/**
 * Parse a key of unknown algorithm (policy/agent keys).
 *
 * **`PrivateKey.fromStringDer()` does not reject a raw 64-hex string — it silently returns
 * a DIFFERENT key** (an ED25519 one). So "try DER, then ECDSA" is not a safe fallback
 * chain: for raw hex the first branch always wins and always wins wrongly, and the only
 * symptom is INVALID_SIGNATURE at settlement, far from the cause. DER is therefore
 * selected by prefix, never by trial.
 *
 * `expectedPublicKeyDer` closes the remaining ambiguity: raw hex is still valid as both
 * ECDSA and ED25519, so when the caller knows which public key the key must correspond to
 * (we register the agent's), we verify rather than assume.
 */
export function parseKey(raw: string, expectedPublicKeyDer?: string): PrivateKey {
  let s = raw.trim().replace(/^['"]|['"]$/g, '')
  if (s.toLowerCase().startsWith('0x')) s = s.slice(2)
  if (!s) throw new Error('empty Hedera private key')

  const isDer = /^30[0-9a-f]{2}/i.test(s) && s.length > 64
  const candidates: PrivateKey[] = []
  for (const parse of isDer
    ? [() => PrivateKey.fromStringDer(s)]
    : [() => PrivateKey.fromStringECDSA(s), () => PrivateKey.fromStringED25519(s)]) {
    try {
      candidates.push(parse())
    } catch {
      /* next */
    }
  }
  if (candidates.length === 0) {
    throw new Error('could not parse a Hedera private key (expected 64-hex or DER)')
  }
  if (!expectedPublicKeyDer) return candidates[0]

  const match = candidates.find((k) => k.publicKey.toStringDer() === expectedPublicKeyDer)
  if (!match) {
    throw new Error(
      'the configured key does not derive the expected public key — ' +
        'it is a different key, or a different algorithm than the one registered',
    )
  }
  return match
}

interface Treasury {
  client: Client
  accountId: string
  key: PrivateKey
  policyKey: PrivateKey
}

let cached: Treasury | null = null

/** Treasury client, built once per process from env. */
export async function treasury(): Promise<Treasury> {
  if (cached) return cached
  const accountId = env('HEDERA_OPERATOR_ID')
  const key = await resolveAccountKey(accountId, env('HEDERA_OPERATOR_KEY'))
  const policyKey = parseKey(env('HEDERA_POLICY_KEY'))
  const client = (network() === 'mainnet' ? Client.forMainnet() : Client.forTestnet()).setOperator(
    accountId,
    key,
  )
  cached = { client, accountId, key, policyKey }
  return cached
}

export interface Envelope {
  accountId: string
  scheduleId: string | null
  fundedUsd: number
  fundedHbar: number
}

/**
 * Mint a single-use envelope funded with exactly the approved ceiling, and schedule its
 * own refund at plan expiry so an abandoned plan returns the money with no keeper
 * running. Schedules carry a fixed amount, so this covers the abandoned case; a partly
 * spent envelope is swept by `sweepEnvelope`.
 */
export async function createEnvelope(opts: {
  agentPublicKey: string
  ceilingUsd: number
  expiresAt: Date
}): Promise<Envelope> {
  const { client, accountId: treasuryId, key: treasuryKey, policyKey } = await treasury()
  const agentPub = PublicKey.fromString(opts.agentPublicKey)

  const dualControl = new KeyList([agentPub, policyKey.publicKey], 2)
  const envelopeKey = new KeyList([dualControl, treasuryKey.publicKey], 1)

  const fundedHbar = usdToHbar(opts.ceilingUsd)
  const created = await (
    await new AccountCreateTransaction()
      .setKeyWithoutAlias(envelopeKey)
      .setInitialBalance(new Hbar(fundedHbar))
      .execute(client)
  ).getReceipt(client)
  const accountId = created.accountId!.toString()

  // Keeperless refund. HSS caps expiry at 62 days; clamp defensively.
  let scheduleId: string | null = null
  try {
    const maxExpiry = new Date(Date.now() + 60 * 24 * 3600 * 1000)
    const when = opts.expiresAt < maxExpiry ? opts.expiresAt : maxExpiry
    const refund = new TransferTransaction()
      .addHbarTransfer(accountId, new Hbar(-fundedHbar))
      .addHbarTransfer(treasuryId, new Hbar(fundedHbar))
    const scheduled = await (
      await new ScheduleCreateTransaction()
        .setScheduledTransaction(refund)
        .setExpirationTime(Timestamp.fromDate(when))
        .setWaitForExpiry(true)
        .execute(client)
    ).getReceipt(client)
    scheduleId = scheduled.scheduleId?.toString() ?? null
  } catch (err) {
    // An envelope without a schedule is still bounded and still sweepable — the refund
    // is a convenience, not the enforcement. Never fail minting over it.
    console.warn(`[hedera] refund schedule failed for ${accountId}:`, (err as Error).message)
  }

  return { accountId, scheduleId, fundedUsd: opts.ceilingUsd, fundedHbar }
}

export async function envelopeBalanceUsd(accountId: string): Promise<number> {
  const { client } = await treasury()
  const balance = await new AccountBalanceQuery().setAccountId(accountId).execute(client)
  return hbarToUsd(balance.hbars.toBigNumber().toNumber())
}

/**
 * Return whatever is left to the treasury. Needs no extra signature: the treasury pays
 * the fee, and the fee payer's signature satisfies the envelope key's outer 1-of
 * (finding 1). Leaves the account empty rather than deleting it, so the trail survives.
 */
export async function sweepEnvelope(accountId: string): Promise<{ sweptUsd: number }> {
  const { client, accountId: treasuryId } = await treasury()
  const balance = await new AccountBalanceQuery().setAccountId(accountId).execute(client)
  const hbars = balance.hbars.toBigNumber().toNumber()

  // Leave a sliver for the transfer fee; sweeping to exactly zero fails on fees.
  const sweepable = Number((hbars - 0.05).toFixed(8))
  if (sweepable <= 0) return { sweptUsd: 0 }

  await (
    await new TransferTransaction()
      .addHbarTransfer(accountId, new Hbar(-sweepable))
      .addHbarTransfer(treasuryId, new Hbar(sweepable))
      .execute(client)
  ).getReceipt(client)

  return { sweptUsd: hbarToUsd(sweepable) }
}

/** Create the audit topic once; the id goes in HCS_TOPIC_ID and is reused forever after. */
export async function createHcsTopic(memo = 'PlanBound audit trail'): Promise<string> {
  const { client } = await treasury()
  const receipt = await (
    await new TopicCreateTransaction().setTopicMemo(memo).execute(client)
  ).getReceipt(client)
  return receipt.topicId!.toString()
}

/**
 * Append one event to the public audit trail. Deliberately non-throwing: a consensus
 * hiccup must never break a payment path, and a missing receipt is visible in the
 * console diff rather than silently pretended.
 */
export async function hcsLog(
  event: HcsEvent,
  payload: Record<string, unknown>,
): Promise<{ seq: number | null }> {
  const topicId = process.env.HCS_TOPIC_ID
  if (!topicId) {
    console.warn(`[hedera] HCS_TOPIC_ID unset — '${event}' not logged to consensus`)
    return { seq: null }
  }
  try {
    const { client } = await treasury()
    const receipt = await (
      await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify({ event, at: new Date().toISOString(), ...payload }))
        .execute(client)
    ).getReceipt(client)
    return { seq: receipt.topicSequenceNumber?.toNumber() ?? null }
  } catch (err) {
    console.warn(`[hedera] hcsLog('${event}') failed:`, (err as Error).message)
    return { seq: null }
  }
}

/**
 * An x402 client signer whose payer is the **envelope account** — the account bounded by
 * the approved ceiling. This is the whole product in one function: the thing that enforces
 * the cap and the thing that pays the seller are the same account, on the same chain.
 *
 * Two signatures go on, agent and policy, satisfying the inner 2-of-2. Neither alone is
 * enough. The threshold is completed by a third signature we never hold: the facilitator's,
 * added when it pays the transaction fee (spike S1). That is why the transaction id is
 * generated against the facilitator's fee payer — it is the payer, and its signature counts.
 *
 * Shaped to match `createClientHederaSigner` from @x402/hedera 2.19 (read from dist, not
 * guessed); it differs only in signing twice and in never holding the treasury key.
 */
export function createEnvelopeSigner(opts: {
  envelopeAccountId: string
  agentKey: PrivateKey
  policyKey: PrivateKey
}): {
  accountId: string
  createPartiallySignedTransferTransaction: (requirements: {
    network: string
    amount: string
    asset: string
    payTo: string
    extra?: { feePayer?: string }
  }) => Promise<string>
} {
  return {
    accountId: opts.envelopeAccountId,
    createPartiallySignedTransferTransaction: async (requirements) => {
      const feePayer = requirements.extra?.feePayer
      if (typeof feePayer !== 'string') {
        throw new Error('feePayer is required in paymentRequirements.extra')
      }
      const amount = BigInt(requirements.amount)
      if (amount <= 0n) throw new Error('amount must be greater than zero')
      if (requirements.asset !== '0.0.0') {
        throw new Error(`envelope pays HBAR only, got asset ${requirements.asset}`)
      }

      const { client } = await treasury() // network config only; the treasury never signs here
      const tx = new TransferTransaction()
        .addHbarTransfer(opts.envelopeAccountId, Hbar.fromTinybars((-amount).toString()))
        .addHbarTransfer(requirements.payTo, Hbar.fromTinybars(amount.toString()))
        .setTransactionId(TransactionId.generate(feePayer))
        .freezeWith(client)

      const signed = await (await tx.sign(opts.agentKey)).sign(opts.policyKey)
      return Buffer.from(signed.toBytes()).toString('base64')
    },
  }
}

/** Hashscan links for the console and the README — built from env, never hardcoded. */
export const hashscan = {
  account: (id: string) => `https://hashscan.io/${network()}/account/${id}`,
  topic: (id: string) => `https://hashscan.io/${network()}/topic/${id}`,
  tx: (id: string) => `https://hashscan.io/${network()}/transaction/${id}`,
}
