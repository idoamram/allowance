/**
 * Generate secp256k1 keypairs into .env.local — private material never leaves the file.
 * Prints variable names and derived public addresses only (secrets protocol: agents
 * read exit codes and public values, never the file). Skips names already set.
 *
 * Usage: pnpm keygen VAR_NAME [VAR_NAME...]
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const ENV = '.env.local'
const names = process.argv.slice(2)
if (names.length === 0) {
  console.error('usage: pnpm keygen VAR_NAME [VAR_NAME...]')
  process.exit(1)
}

if (!existsSync(ENV)) {
  writeFileSync(ENV, '# PlanBound local secrets — gitignored, never read by agents\n')
}
const present = new Set(
  readFileSync(ENV, 'utf8')
    .split('\n')
    .map((l) => l.split('=')[0]?.trim())
    .filter(Boolean),
)

for (const name of names) {
  if (present.has(name)) {
    console.log(`${name}: already set — skipped`)
    continue
  }
  const key = generatePrivateKey()
  const { address } = privateKeyToAccount(key)
  appendFileSync(ENV, `${name}=${key}\n`)
  console.log(`${name}: generated → public address ${address}`)
}
