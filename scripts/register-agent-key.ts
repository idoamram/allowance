/**
 * Register the agent's PUBLIC key so the control plane can mint envelopes whose key
 * structure includes it. The private key stays in .env.local and is never transmitted,
 * printed, or stored.
 *
 * Usage: pnpm register:agent [name]     (default: dogfood)
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { PrivateKey } from '@hiero-ledger/sdk'
import { privateKeyToAccount } from 'viem/accounts'

config({ path: '.env.local' })

const name = process.argv[2] ?? 'dogfood'
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const agentKey = process.env.AGENT_EVM_KEY
if (!url || !serviceKey || !agentKey) {
  console.error('blocked: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and AGENT_EVM_KEY must be in .env.local')
  process.exit(1)
}

const hex = agentKey.startsWith('0x') ? agentKey.slice(2) : agentKey
const hederaPublicKey = PrivateKey.fromStringECDSA(hex).publicKey.toStringDer()
const evmAddress = privateKeyToAccount(`0x${hex}` as `0x${string}`).address

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
const { data, error } = await supabase
  .from('agents')
  .update({ hedera_public_key: hederaPublicKey, evm_address: evmAddress })
  .eq('name', name)
  .select('id, name')
  .single()

if (error) {
  console.error('register failed:', error.message)
  process.exit(1)
}
// Public values only.
console.log(`registered ${data.name}: evm ${evmAddress}`)
console.log(`hedera public key: ${hederaPublicKey.slice(0, 24)}…`)
