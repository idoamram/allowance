/**
 * Create the HCS audit topic once and write its id to .env.local.
 * The topic id is a public identifier (it goes in the console and the README), but it
 * still lives in env so a cloner gets their own rather than writing to ours.
 *
 * Usage: pnpm hcs:topic
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { config } from 'dotenv'
import { createHcsTopic, hashscan } from '../packages/chains/hedera'

const ENV = '.env.local'
config({ path: ENV })

const existing = process.env.HCS_TOPIC_ID
if (existing) {
  console.log(`HCS_TOPIC_ID already set: ${existing}`)
  console.log(hashscan.topic(existing))
  process.exit(0)
}

const topicId = await createHcsTopic('PlanBound audit trail')

const body = readFileSync(ENV, 'utf8')
if (/^HCS_TOPIC_ID=\s*$/m.test(body)) {
  // Replace the empty placeholder rather than appending a duplicate key.
  const next = body.replace(/^HCS_TOPIC_ID=\s*$/m, `HCS_TOPIC_ID=${topicId}`)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(ENV, next)
} else {
  appendFileSync(ENV, `HCS_TOPIC_ID=${topicId}\n`)
}

console.log(`HCS topic created: ${topicId}`)
console.log(hashscan.topic(topicId))
process.exit(0)
