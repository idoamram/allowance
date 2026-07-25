/**
 * Shared Hedera key handling for spikes and T7 (findings from S1, 2026-07-25):
 * raw 64-hex private keys are algorithm-ambiguous (ED25519 vs ECDSA) and the wrong
 * guess fails precheck INVALID_SIGNATURE — resolve the algorithm from the account's
 * public mirror-node record and verify the derived public key before any transaction.
 * Never print private material; shape diagnostics only.
 */
import { PrivateKey } from '@hiero-ledger/sdk'

export const need = (name: string): string => {
  const v = process.env[name]
  if (!v) {
    console.error(`blocked: ${name} missing from .env.local`)
    process.exit(1)
  }
  return v
}

export const parseKey = (name: string, raw: string): PrivateKey => {
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
  console.error(`blocked: could not parse ${name} (length ${s.length}; expected 64-hex or DER)`)
  process.exit(1)
}

export const resolveAccountKey = async (
  accountId: string,
  raw: string,
  mirrorBase = 'https://testnet.mirrornode.hedera.com',
): Promise<PrivateKey> => {
  const res = await fetch(`${mirrorBase}/api/v1/accounts/${accountId}`)
  if (!res.ok) {
    console.error(`blocked: mirror node has no account ${accountId} (HTTP ${res.status})`)
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
    if (k.publicKey.toStringRaw().toLowerCase() === onChainPub) return k
  }
  console.error(
    `blocked: the private key does not correspond to account ${accountId} ` +
      `(mirror says ${keyType || 'unknown'}, public ${onChainPub.slice(0, 16)}…)`,
  )
  process.exit(1)
}
