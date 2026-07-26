#!/usr/bin/env tsx
/**
 * The headless dogfood agent — and our test harness for the whole approval loop.
 *
 *   pnpm driver "vet 3 counterparty wallets before I pay them"
 *   pnpm driver --dry "brief me on BTC market conditions"   # quote only, nothing submitted
 *   pnpm driver --max-step 0.10 --ceiling 1.20 --timeout 300 "…"
 *
 * It does exactly what the MCP tools do, in the same order an agent would: quote the task,
 * submit the plan, print the approval URL, wait for the human — then, once approved, read
 * the envelope, buy each step from inside it, and close the plan so the remainder goes
 * home. Every plan it runs is real decision data; the learning loop is seeded by using the
 * product to build the product, so this script is the seed drill.
 *
 * Drift stops it. If the gate refuses a step, the run halts there and prints the link the
 * human decides from — continuing would spend against a plan they are reconsidering.
 *
 * It never hangs: the polling wait is bounded, and a missing environment variable is a
 * one-line error rather than a stall.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import {
  awaitApproval,
  closePlan,
  getEnvelope,
  payAndCall,
  quoteTask,
  submitPlan,
} from '../packages/mcp/tools'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: resolve(repoRoot, '.env.local'), quiet: true } as Parameters<typeof loadEnv>[0])

interface Args {
  goal: string
  dry: boolean
  maxUsdPerStep?: number
  ceilingUsd?: number
  tolerancePct?: number
  expiresInMin?: number
  timeoutSec: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = { goal: '', dry: false, timeoutSec: 600 }
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const num = () => Number(argv[++i])
    if (a === '--dry') args.dry = true
    else if (a === '--max-step') args.maxUsdPerStep = num()
    else if (a === '--ceiling') args.ceilingUsd = num()
    else if (a === '--tolerance') args.tolerancePct = num()
    else if (a === '--expires') args.expiresInMin = num()
    else if (a === '--timeout') args.timeoutSec = num()
    else if (a.startsWith('--')) fatal(`unknown flag ${a}`)
    else rest.push(a)
  }
  args.goal = rest.join(' ').trim()
  if (!args.goal) fatal('usage: pnpm driver [--dry] [--max-step N] [--ceiling N] "<goal>"')
  return args
}

function fatal(message: string): never {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`
const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))

/** The priced table, badges and all. This is what the operator judges before a human sees it. */
function printPlan(plan: Awaited<ReturnType<typeof quoteTask>>) {
  console.log(`\n  goal      ${plan.goal}`)
  console.log(`  approach  ${plan.approach}\n`)
  for (const [i, s] of plan.steps.entries()) {
    // The badge is the quote source, verbatim. Never dress an estimate as a quote.
    const badge = s.source === 'live-402' ? '[live]' : '[est.]'
    console.log(`  ${i}  ${badge} ${pad(s.serviceName, 34)} ${usd(s.quoteUsd).padStart(8)}  ${s.rail}`)
    console.log(`         ↳ ${s.why}`)
  }
  console.log(`\n  total     ${usd(plan.totalUsd)}   (suggested ceiling ${usd(plan.suggestedCeilingUsd)})`)
  console.log(
    `  check     ${plan.selfCheck.turns} pass(es), ${plan.selfCheck.fixes.length} fix(es)`,
  )
  for (const fix of plan.selfCheck.fixes) console.log(`         · ${fix}`)
  for (const gap of plan.gaps) console.log(`  gap       ${gap}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log('\n  ── quoting ──────────────────────────────────────────────')
  const plan = await quoteTask({ goal: args.goal, maxUsdPerStep: args.maxUsdPerStep })
  printPlan(plan)

  if (plan.steps.length === 0) fatal(plan.note ?? 'no quotable sellers — nothing to submit')
  if (args.dry) {
    console.log('\n  --dry: stopping before submission.\n')
    return
  }

  console.log('\n  ── submitting ───────────────────────────────────────────')
  const submitted = await submitPlan({
    goal: args.goal,
    approach: plan.approach,
    steps: plan.steps,
    ceilingUsd: args.ceilingUsd ?? plan.suggestedCeilingUsd,
    tolerancePct: args.tolerancePct,
    expiresInMin: args.expiresInMin,
    selfCheck: plan.selfCheck,
  })
  console.log(`\n  plan      ${submitted.planId}`)
  console.log(`  ceiling   ${usd(submitted.ceilingUsd)} for ${usd(submitted.totalUsd)} of quotes`)
  console.log(`\n  APPROVE   ${submitted.approvalUrl}\n`)

  console.log(`  ── waiting for the human (up to ${args.timeoutSec}s) ─────────`)
  const outcome = await awaitApproval({ planId: submitted.planId, timeoutSec: args.timeoutSec })

  if (outcome.timedOut) {
    console.log(`\n  ⏳ still ${outcome.status} after ${args.timeoutSec}s — nobody has looked yet.`)
    console.log(`     The link stays valid until the plan expires.\n`)
    process.exit(2)
  }

  const decision = outcome.decision as { outcome?: string; target?: string; reason?: string } | null
  console.log(`\n  status    ${outcome.status}`)
  if (decision?.outcome) console.log(`  decision  ${decision.outcome}`)
  if (decision?.target) console.log(`  objection ${decision.target}: ${decision.reason ?? ''}`)

  if (outcome.status !== 'approved') {
    console.log('\n  ✗ nothing was funded. The reason above is what the learning loop reads.\n')
    process.exit(3)
  }

  // ── the envelope now exists; everything below spends from it and nothing else ────────
  // awaitApproval already waited for the mint, but minting is an account create plus a
  // scheduled refund plus two HCS messages — if it ran long, keep waiting here rather
  // than reporting a failure for something that is merely still in flight.
  let env = await getEnvelope({ planId: submitted.planId })
  for (let i = 0; i < 20 && !('envelope' in env); i++) {
    await new Promise((r) => setTimeout(r, 3_000))
    env = await getEnvelope({ planId: submitted.planId })
  }
  if (!('envelope' in env)) {
    fatal(`approved, but no envelope was minted after 60s: ${env.reason}`)
  }
  const envelope = env.envelope as { hedera_account?: string; funded_usd?: number | string }
  console.log('\n  ── envelope ─────────────────────────────────────────────')
  console.log(`  account   ${envelope.hedera_account ?? '(none)'}`)
  console.log(`  funded    ${usd(Number(envelope.funded_usd ?? 0))}`)

  console.log('\n  ── executing inside it ──────────────────────────────────')
  let paidTotal = 0
  let blocked = false

  // Step index is position in the submitted plan — the same ordering the server stored.
  for (const [idx, step] of plan.steps.entries()) {
    const res = await payAndCall({ planId: submitted.planId, stepIdx: idx })

    if (res.status === 'paid') {
      paidTotal += res.paidUsd
      console.log(`  ${idx}  ✓ ${step.serviceName.padEnd(30)} ${usd(res.paidUsd)}`)
      if (res.txRef) console.log(`         ↳ ${res.txRef}`)
      continue
    }

    if (res.status === 'blocked') {
      // The point of the whole product: the wall, and a human who gets a diff rather than
      // a popup. Stop here — running the remaining steps would spend against a plan the
      // human is in the middle of reconsidering.
      blocked = true
      console.log(`  ${idx}  ✗ ${step.serviceName} — ${res.reason}`)
      console.log(`         approved ${usd(res.approvedUsd)}, ceiling ${usd(res.maxAllowedUsd)}`)
      console.log(`         seller now asks ${usd(res.liveAskUsd)}`)
      console.log(`\n  DECIDE    ${res.diffUrl}\n`)
      console.log('  Stopped. The envelope still holds the remainder; nothing was overspent.')
      break
    }

    console.log(`  ${idx}  · ${step.serviceName} — refused: ${res.reason}`)
  }

  if (blocked) process.exit(4)

  const closed = await closePlan({ planId: submitted.planId })
  console.log('\n  ── settled ──────────────────────────────────────────────')
  console.log(`  paid      ${usd(paidTotal)} of ${usd(Number(envelope.funded_usd ?? 0))} funded`)
  if (closed.sweptUsd !== undefined) console.log(`  swept     ${usd(Number(closed.sweptUsd))} back`)
  console.log(
    '\n  ✓ quoted equals paid, and the remainder went home. The envelope is closed.\n',
  )
}

main().catch((error: unknown) => fatal(error instanceof Error ? error.message : String(error)))
