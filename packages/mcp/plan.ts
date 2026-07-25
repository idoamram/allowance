/**
 * `quote_task`'s brain: turn a goal into a priced, reasoned plan.
 *
 * Three rules this file exists to enforce, all of them product code (latest.md §5):
 *  1. A price is either a live 402 quote or an estimate, and it is labeled as such.
 *     Nothing here ever invents a number for a step it could not quote.
 *  2. A category with no seller becomes a *stated gap*, never a padded step.
 *  3. The self-check is bounded (≤3 passes) and every fix it makes is logged, because
 *     the human is shown the fixes — an unlogged fix is an unreviewable one.
 *
 * The plan is composed one *category* at a time — a category is a question the goal
 * needs answered. Each category is shopped independently, so one dead corner of the
 * market costs one answer, not the whole plan.
 */
import { createRequire } from 'node:module'
import {
  discover as liveDiscover,
  quoteSteps as liveQuoteSteps,
  type Candidate,
  type QuotedStep,
} from '@planbound/chains'
import { round6, totalUsd, type Rail, type StepInput } from '@planbound/core'

const require = createRequire(import.meta.url)
/** Pinned, live-probed sellers from spike S3 — the fallback when the Bazaar is thin. */
const demoSellers = require('@planbound/chains/demo-sellers.json') as Record<
  string,
  { url: string; name: string; priceUsd: number; source: string }[]
>

/** Rails this build can actually settle on. A step on anything else is dropped, not guessed. */
const RAIL_BY_NETWORK: Record<string, Rail> = {
  'eip155:480': 'worldchain',
  'eip155:8453': 'base',
  'hedera:testnet': 'hedera',
  'hedera:mainnet': 'hedera',
}

/** Worldchain first (the sponsor rail with a real seller market), Base as the fallback. */
export const DEFAULT_NETWORKS = ['eip155:480', 'eip155:8453']
const MAX_SELF_CHECK_TURNS = 3
const CANDIDATES_PER_CATEGORY = 6

export const railOf = (network: string): Rail | null => RAIL_BY_NETWORK[network] ?? null

/** One question the goal needs answered, and how to shop for the answer. */
export interface CategorySpec {
  /** Key into demo-sellers.json for the pinned fallback; null when none is pinned. */
  pinned: string | null
  /** Short label — used in the approach line and in gap notes. */
  label: string
  /** What we ask the Bazaar. */
  query: string
  /** What the step yields toward the goal (becomes StepInput.buys). */
  buys: string
  /** One line: why the step earns its price (becomes StepInput.why). */
  why: string
}

interface Playbook {
  match: RegExp
  categories: CategorySpec[]
}

/**
 * Goal → categories. Deliberately small and explicit: a wrong decomposition is a
 * wrong plan, and a hand-written table is one a human can argue with.
 */
const PLAYBOOKS: Playbook[] = [
  {
    match: /\b(wallet|address|counterpart\w*|vet|kyc|sanction\w*|due diligence)\b/i,
    categories: [
      {
        pinned: 'risk',
        label: 'risk score',
        query: 'wallet risk score',
        buys: 'a risk score per counterparty wallet',
        why: 'the cheapest signal that an address is already known-bad',
      },
      {
        pinned: 'age',
        label: 'wallet age',
        query: 'wallet age and activity history',
        buys: 'first-seen date and activity history per wallet',
        why: 'a wallet minted this week is a different counterparty than one active for years',
      },
      {
        pinned: 'networth',
        label: 'holdings',
        query: 'wallet net worth token holdings',
        buys: 'current token holdings and net worth per wallet',
        why: 'a counterparty that cannot cover the trade is the failure this catches early',
      },
      {
        pinned: 'sanctions',
        label: 'sanctions screen',
        query: 'OFAC sanctions screening address',
        buys: 'an OFAC and global sanctions check per wallet',
        why: 'paying a sanctioned address is the one error whose cost is legal, not financial',
      },
    ],
  },
  {
    match: /\b(market|btc|bitcoin|price|allocat\w*|derivativ\w*|trade|trading)\b/i,
    categories: [
      {
        pinned: 'market',
        label: 'derivatives flow',
        query: 'bitcoin derivatives flow metrics',
        buys: 'the current BTC derivatives fee and flow curve',
        why: 'positioning moves before price does — this is the leading half of the brief',
      },
      {
        pinned: 'market',
        label: 'on-chain supply',
        query: 'bitcoin on-chain holder supply metrics',
        buys: 'on-chain holder concentration and coin-days-destroyed',
        why: 'flow without holder behaviour reads every spike as the same event',
      },
    ],
  },
]

/** Fallback decomposition: one category, the goal as the query. Honest about being generic. */
const genericCategories = (goal: string): CategorySpec[] => [
  {
    pinned: null,
    label: 'the task',
    query: goal,
    buys: `data for: ${goal}`.slice(0, 300),
    why: 'the only seller class the Bazaar surfaces for this goal',
  },
]

export const categoriesFor = (goal: string): CategorySpec[] =>
  PLAYBOOKS.find((p) => p.match.test(goal))?.categories ?? genericCategories(goal)

/**
 * Pinned sellers carry their probe network inside the `source` note (S3 recorded it
 * there). Reading it back beats hardcoding a rail per category — the note is evidence.
 */
const pinnedCandidates = (key: string | null): Candidate[] => {
  if (!key) return []
  return (demoSellers[key] ?? []).map((s) => ({
    url: s.url,
    name: s.name,
    priceUsd: s.priceUsd,
    network: s.source.match(/(eip155:\d+|hedera:\w+)/)?.[1] ?? 'eip155:8453',
    description: `pinned fallback (${s.source})`,
  }))
}

export interface QuoteDeps {
  discover: typeof liveDiscover
  quoteSteps: typeof liveQuoteSteps
}

export const liveDeps: QuoteDeps = { discover: liveDiscover, quoteSteps: liveQuoteSteps }

/** Everything the market offered for one category, already priced and labeled. */
interface Pool {
  spec: CategorySpec
  options: QuotedStep[]
}

/**
 * Shop one category: try each rail in priority order, fall back to the pinned list.
 * The pinned list is re-quoted like anything else — a pinned price is never trusted
 * as a live quote just because we wrote it down yesterday.
 */
async function shop(
  spec: CategorySpec,
  opts: { maxUsdPerStep?: number; networks: string[] },
  deps: QuoteDeps,
): Promise<Pool> {
  for (const network of opts.networks) {
    const candidates = await deps.discover(spec.query, {
      limit: CANDIDATES_PER_CATEGORY,
      maxUsdPrice: opts.maxUsdPerStep,
      network,
    })
    if (candidates.length === 0) continue
    const quoted = await deps.quoteSteps(candidates)
    if (quoted.length > 0) return { spec, options: quoted }
  }
  const pinned = pinnedCandidates(spec.pinned)
  if (pinned.length === 0) return { spec, options: [] }
  return { spec, options: await deps.quoteSteps(pinned) }
}

/** A live quote is a fact; an estimate is a claim. Facts win, then price, then usage. */
const rank = (a: QuotedStep, b: QuotedStep): number => {
  if (a.source !== b.source) return a.source === 'live-402' ? -1 : 1
  if (a.quoteUsd !== b.quoteUsd) return a.quoteUsd - b.quoteUsd
  return (b.calls30d ?? 0) - (a.calls30d ?? 0)
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

interface Selected {
  spec: CategorySpec
  step: QuotedStep
}

/** One step per category, best first, never the same endpoint twice, banned URLs excluded. */
function select(pools: Pool[], banned: Set<string>): Selected[] {
  const taken = new Set<string>()
  const picked: Selected[] = []
  for (const pool of pools) {
    const choice = [...pool.options]
      .sort(rank)
      .find((o) => !banned.has(o.url) && !taken.has(o.url))
    if (!choice) continue
    taken.add(choice.url)
    picked.push({ spec: pool.spec, step: choice })
  }
  return picked
}

const money = (n: number): string => `$${n.toFixed(n < 0.1 ? 4 : 2)}`

/**
 * The self-check's eyes. Returns the problems found in a selection, each with the
 * sentence the human will read. Empty means the plan survived the pass.
 */
function audit(
  selection: Selected[],
  pools: Pool[],
  banned: Set<string>,
  maxUsdPerStep?: number,
): { url: string; fix: string }[] {
  const problems: { url: string; fix: string }[] = []
  const hostsUsed = new Set<string>()

  for (const { spec, step } of selection) {
    const label = `${step.name} (${spec.label})`

    if (maxUsdPerStep != null && step.quoteUsd > maxUsdPerStep) {
      problems.push({
        url: step.url,
        fix: `dropped ${label}: ${money(step.quoteUsd)} is over the ${money(maxUsdPerStep)} per-step cap — re-shopped the category`,
      })
      continue
    }
    if (railOf(step.network) === null) {
      problems.push({
        url: step.url,
        fix: `dropped ${label}: settles on ${step.network}, which this build has no rail for`,
      })
      continue
    }
    if (!(step.quoteUsd > 0)) {
      problems.push({
        url: step.url,
        fix: `dropped ${label}: quoted ${money(step.quoteUsd)}, which is not a price we can gate on`,
      })
      continue
    }

    const host = hostOf(step.url)
    if (hostsUsed.has(host)) {
      // Same host twice is allowed — it is often the same vendor selling different data.
      // We only swap when the market actually offers an alternative at a comparable price,
      // so one dead host cannot take out two steps of the plan.
      const alternative = [...(pools.find((p) => p.spec === spec)?.options ?? [])]
        .sort(rank)
        .find(
          (o) =>
            !banned.has(o.url) &&
            hostOf(o.url) !== host &&
            o.quoteUsd <= step.quoteUsd * 1.2 &&
            (maxUsdPerStep == null || o.quoteUsd <= maxUsdPerStep) &&
            railOf(o.network) !== null,
        )
      if (alternative) {
        problems.push({
          url: step.url,
          fix: `swapped ${label} for ${alternative.name}: the plan already buys from ${host}, and one dead host should not cost two steps`,
        })
        continue
      }
    }
    hostsUsed.add(host)
  }
  return problems
}

export interface QuotedPlan {
  approach: string
  steps: StepInput[]
  selfCheck: { turns: number; fixes: string[] }
  /** Questions the market could not answer — stated, never padded over. */
  gaps: string[]
  totalUsd: number
  /** Total plus drift headroom. The human still decides the real ceiling. */
  suggestedCeilingUsd: number
}

/** One sentence of logic for the whole plan, assembled from facts, not adjectives. */
function composeApproach(goal: string, selection: Selected[], total: number): string {
  if (selection.length === 0) return `No priced plan for: ${goal} — the market returned nothing quotable.`
  const live = selection.filter((s) => s.step.source === 'live-402').length
  const est = selection.length - live
  const labels = selection.map((s) => s.spec.label).join(', ')
  const sourcing =
    est === 0
      ? 'all live-quoted'
      : live === 0
        ? 'all estimated, none live-quoted'
        : `${live} live-quoted, ${est} estimated`
  const rails = [...new Set(selection.map((s) => railOf(s.step.network)))].join(' + ')
  return `Answer "${goal}" with ${selection.length} independent ${
    selection.length === 1 ? 'check' : 'checks'
  } — ${labels} — bought from x402 sellers on ${rails} (${sourcing}), ${money(total)} total.`.slice(0, 500)
}

/**
 * Discover → quote → self-check → compose. The whole of `quote_task`, minus the wire.
 */
export async function buildPlan(
  goal: string,
  opts: { maxUsdPerStep?: number; networks?: string[] } = {},
  deps: QuoteDeps = liveDeps,
): Promise<QuotedPlan> {
  const specs = categoriesFor(goal)
  const networks = opts.networks ?? DEFAULT_NETWORKS
  const pools = await Promise.all(
    specs.map((spec) => shop(spec, { maxUsdPerStep: opts.maxUsdPerStep, networks }, deps)),
  )

  const banned = new Set<string>()
  const fixes: string[] = []
  let selection = select(pools, banned)
  let turns = 1
  while (turns <= MAX_SELF_CHECK_TURNS) {
    const problems = audit(selection, pools, banned, opts.maxUsdPerStep)
    if (problems.length === 0) break
    for (const p of problems) {
      banned.add(p.url)
      fixes.push(p.fix)
    }
    selection = select(pools, banned)
    if (turns === MAX_SELF_CHECK_TURNS) break // bounded: the last pass is not re-audited
    turns++
  }

  // A category that survived the loop but still fails the audit was never fixable —
  // drop it here rather than ship a step the gate would reject anyway.
  const stillBroken = new Set(audit(selection, pools, banned, opts.maxUsdPerStep).map((p) => p.url))
  selection = selection.filter((s) => !stillBroken.has(s.step.url))

  const steps: StepInput[] = selection.map(({ spec, step }) => ({
    serviceUrl: step.url,
    serviceName: step.name,
    quoteUsd: round6(step.quoteUsd),
    source: step.source,
    buys: spec.buys,
    why: spec.why,
    rail: railOf(step.network) as Rail,
  }))

  const covered = new Set(selection.map((s) => s.spec.label))
  const gaps = specs
    .filter((s) => !covered.has(s.label))
    .map(
      (s) =>
        `no seller found for ${s.label} — left out of the plan rather than padded with a guessed price`,
    )

  const total = totalUsd(steps)
  return {
    approach: composeApproach(goal, selection, total),
    steps,
    selfCheck: { turns, fixes },
    gaps,
    totalUsd: total,
    suggestedCeilingUsd: Math.ceil(total * 1.2 * 100) / 100,
  }
}
