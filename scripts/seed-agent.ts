/**
 * Create the dogfood agent row. Generates PLANBOUND_AGENT_TOKEN into .env.local if it
 * isn't there yet and stores only its sha256 — the token itself never leaves that file
 * and is never printed.
 *
 * Usage: pnpm seed:agent [name]     (default name: dogfood)
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const ENV = '.env.local'
config({ path: ENV })

const name = process.argv[2] ?? 'dogfood'
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('blocked: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env.local')
  process.exit(1)
}

let token = process.env.PLANBOUND_AGENT_TOKEN
if (!token) {
  token = `pbt_${randomBytes(24).toString('base64url')}`
  if (!existsSync(ENV)) {
    console.error(`blocked: ${ENV} not found`)
    process.exit(1)
  }
  const hasLine = readFileSync(ENV, 'utf8').includes('PLANBOUND_AGENT_TOKEN=')
  appendFileSync(ENV, `${hasLine ? '' : ''}PLANBOUND_AGENT_TOKEN=${token}\n`)
  console.log(`PLANBOUND_AGENT_TOKEN: generated and written to ${ENV}`)
}

const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex')
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

const { data, error } = await supabase
  .from('agents')
  .upsert({ name, token_hash: tokenHash }, { onConflict: 'name' })
  .select('id, name')
  .single()

if (error) {
  console.error('seed failed:', error.message)
  process.exit(1)
}
console.log(`agent ready: ${data.name} (${data.id})`)
