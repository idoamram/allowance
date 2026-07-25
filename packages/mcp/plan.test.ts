import { describe, expect, it } from 'vitest'
import type { Candidate, QuotedStep } from '@planbound/chains'
import { buildPlan, categoriesFor, railOf, type QuoteDeps } from './plan'

const candidate = (over: Partial<Candidate> & { url: string }): Candidate => ({
  name: over.name ?? new URL(over.url).hostname,
  priceUsd: 0.02,
  network: 'eip155:480',
  description: '',
  ...over,
})

/**
 * A fake market: `byQuery` decides what each category's search returns, and every
 * candidate is quoted live unless it appears in `estimates`. No network, no clock.
 */
function fakeDeps(
  byQuery: (query: string, network: string) => Candidate[],
  opts: { estimates?: Set<string>; drop?: (url: string) => boolean } = {},
): QuoteDeps {
  return {
    discover: async (query, o = {}) => byQuery(query, o.network ?? 'eip155:8453'),
    quoteSteps: async (candidates) =>
      candidates
        .filter((c) => !opts.drop?.(c.url)) // dead endpoints never reach a plan
        .map(
          (c): QuotedStep => ({
            ...c,
            quoteUsd: c.priceUsd ?? 0.01,
            source: opts.estimates?.has(c.url) ? 'estimate' : 'live-402',
          }),
        ),
  }
}

/** The pinned fallback list is real hosts; this drops it so a test can starve a category. */
const onlyFakeHosts = (url: string) => !url.endsWith('.example/api')

describe('categoriesFor', () => {
  it('decomposes the demo goal into the four wallet-vetting questions', () => {
    const labels = categoriesFor('vet 3 counterparty wallets before I pay them').map((c) => c.label)
    expect(labels).toEqual(['risk score', 'wallet age', 'holdings', 'sanctions screen'])
  })

  it('routes a market brief to the market playbook', () => {
    expect(categoriesFor('brief me on BTC market conditions').map((c) => c.label)).toEqual([
      'derivatives flow',
      'on-chain supply',
    ])
  })

  it('falls back to a single generic category built from the goal itself', () => {
    const specs = categoriesFor('find me a poem about tuesdays')
    expect(specs).toHaveLength(1)
    expect(specs[0].query).toBe('find me a poem about tuesdays')
    expect(specs[0].pinned).toBeNull()
  })
})

describe('railOf', () => {
  it('maps the three supported networks and refuses the rest', () => {
    expect(railOf('eip155:480')).toBe('worldchain')
    expect(railOf('eip155:8453')).toBe('base')
    expect(railOf('hedera:testnet')).toBe('hedera')
    expect(railOf('eip155:1')).toBeNull()
  })
})

describe('buildPlan — honesty rules', () => {
  /** One distinct seller per category — the shape a healthy market gives back. */
  const slug = (query: string) => query.replace(/[^a-z]/gi, '').slice(0, 12).toLowerCase()
  const oneSellerPerCategory = (query: string) => [
    candidate({ url: `https://${slug(query)}.example/api` }),
  ]
  const sanctionsUrl = `https://${slug('OFAC sanctions screening address')}.example/api`

  it('carries the quote source through to every step, unmodified', async () => {
    const deps = fakeDeps(oneSellerPerCategory, { estimates: new Set([sanctionsUrl]) })
    const plan = await buildPlan('vet 3 counterparty wallets', {}, deps)
    expect(plan.steps).toHaveLength(4)
    expect(plan.steps.filter((s) => s.source === 'estimate')).toHaveLength(1)
    expect(plan.steps.every((s) => s.rail === 'worldchain')).toBe(true)
    expect(plan.totalUsd).toBeCloseTo(0.08, 6)
  })

  it('states a gap instead of padding the plan when a category has no seller', async () => {
    const deps = fakeDeps((q) => (q.includes('sanctions') ? [] : oneSellerPerCategory(q)), {
      drop: onlyFakeHosts,
    })
    const plan = await buildPlan('vet 3 counterparty wallets', {}, deps)
    expect(plan.steps).toHaveLength(3)
    expect(plan.gaps).toEqual([
      'no seller found for sanctions screen — left out of the plan rather than padded with a guessed price',
    ])
    expect(plan.steps.map((s) => s.quoteUsd)).not.toContain(0)
  })

  it('returns no steps at all — and says so — when nothing is quotable', async () => {
    // Bazaar empty *and* every pinned fallback dead: the honest answer is no plan.
    const plan = await buildPlan(
      'vet 3 counterparty wallets',
      {},
      fakeDeps(() => [], { drop: () => true }),
    )
    expect(plan.steps).toEqual([])
    expect(plan.gaps).toHaveLength(4)
    expect(plan.approach).toMatch(/returned nothing quotable/)
  })

  it('prefers a live quote over a cheaper estimate — a fact beats a claim', async () => {
    const deps = fakeDeps(
      () => [
        candidate({ url: 'https://cheap.example/a', name: 'cheap', priceUsd: 0.001 }),
        candidate({ url: 'https://live.example/a', name: 'live', priceUsd: 0.05 }),
      ],
      { estimates: new Set(['https://cheap.example/a']) },
    )
    const plan = await buildPlan('find me a poem about tuesdays', {}, deps)
    expect(plan.steps[0]).toMatchObject({ serviceName: 'live', source: 'live-402' })
  })

  it('drops a seller on a rail this build cannot settle, and logs the fix', async () => {
    const deps = fakeDeps(() => [
      candidate({ url: 'https://mainnet.example/a', name: 'ethereum-only', network: 'eip155:1' }),
      candidate({ url: 'https://world.example/a', name: 'worldchain-ok' }),
    ])
    const plan = await buildPlan('find me a poem about tuesdays', {}, deps)
    expect(plan.steps).toEqual([expect.objectContaining({ serviceName: 'worldchain-ok' })])
    expect(plan.selfCheck.fixes.join()).toMatch(/eip155:1, which this build has no rail for/)
    expect(plan.selfCheck.turns).toBe(2)
  })

  it('re-shops a category whose best seller is over the per-step cap', async () => {
    // The live quote outranks the estimate, so the cap is what has to catch it.
    const deps = fakeDeps(
      () => [
        candidate({ url: 'https://pricey.example/a', name: 'pricey', priceUsd: 0.5 }),
        candidate({ url: 'https://ok.example/a', name: 'ok', priceUsd: 0.04 }),
      ],
      { estimates: new Set(['https://ok.example/a']) },
    )
    const plan = await buildPlan('find me a poem about tuesdays', { maxUsdPerStep: 0.1 }, deps)
    expect(plan.steps).toEqual([expect.objectContaining({ serviceName: 'ok', quoteUsd: 0.04 })])
    expect(plan.selfCheck.fixes.join()).toMatch(/over the \$0.10 per-step cap/)
  })

  it('bounds the self-check at three passes even when every candidate is unusable', async () => {
    const deps = fakeDeps(() =>
      Array.from({ length: 9 }, (_, i) =>
        candidate({ url: `https://bad${i}.example/a`, network: 'eip155:1' }),
      ),
    )
    const plan = await buildPlan('find me a poem about tuesdays', {}, deps)
    expect(plan.selfCheck.turns).toBeLessThanOrEqual(3)
    expect(plan.steps).toEqual([])
    expect(plan.gaps).toHaveLength(1)
  })

  it('never quotes the same endpoint twice across categories', async () => {
    const deps = fakeDeps(() => [candidate({ url: 'https://one.example/a', name: 'only-seller' })])
    const plan = await buildPlan('brief me on BTC market conditions', {}, deps)
    expect(plan.steps).toHaveLength(1)
    expect(plan.gaps).toHaveLength(1)
  })

  it('swaps a same-host duplicate when the market offers a comparable alternative', async () => {
    const deps = fakeDeps((q) =>
      q.includes('derivatives')
        ? [candidate({ url: 'https://vendor.example/flow', name: 'vendor-flow' })]
        : [
            candidate({ url: 'https://vendor.example/supply', name: 'vendor-supply' }),
            candidate({ url: 'https://other.example/supply', name: 'other-supply' }),
          ],
    )
    const plan = await buildPlan('brief me on BTC market conditions', {}, deps)
    expect(plan.steps.map((s) => s.serviceName)).toEqual(['vendor-flow', 'other-supply'])
    expect(plan.selfCheck.fixes.join()).toMatch(/one dead host should not cost two steps/)
  })

  it('keeps a same-host duplicate when there is no alternative — redundancy beats a gap', async () => {
    const deps = fakeDeps((q) =>
      q.includes('derivatives')
        ? [candidate({ url: 'https://vendor.example/flow', name: 'vendor-flow' })]
        : [candidate({ url: 'https://vendor.example/supply', name: 'vendor-supply' })],
    )
    const plan = await buildPlan('brief me on BTC market conditions', {}, deps)
    expect(plan.steps.map((s) => s.serviceName)).toEqual(['vendor-flow', 'vendor-supply'])
    expect(plan.gaps).toEqual([])
  })

  it('tries Worldchain first and only falls back to Base', async () => {
    const asked: string[] = []
    const deps = fakeDeps((_q, network) => {
      asked.push(network)
      return network === 'eip155:8453' ? [candidate({ url: 'https://base.example/a', network })] : []
    })
    const plan = await buildPlan('find me a poem about tuesdays', {}, deps)
    expect(asked).toEqual(['eip155:480', 'eip155:8453'])
    expect(plan.steps[0].rail).toBe('base')
  })

  it('falls back to the pinned demo sellers when the Bazaar returns nothing', async () => {
    // Pinned entries are re-quoted like anything else, so their badges stay honest.
    const deps = fakeDeps(() => [], { estimates: new Set() })
    const plan = await buildPlan('vet 3 counterparty wallets', {}, deps)
    expect(plan.steps).toHaveLength(4)
    expect(plan.steps.every((s) => s.serviceUrl.startsWith('https://'))).toBe(true)
  })

  it('suggests a ceiling above the total — the headroom drift is absorbed by', async () => {
    const plan = await buildPlan('find me a poem about tuesdays', {}, fakeDeps(oneSellerPerCategory))
    expect(plan.suggestedCeilingUsd).toBeGreaterThan(plan.totalUsd)
  })

  it('states the sourcing mix in the approach line', async () => {
    const deps = fakeDeps(oneSellerPerCategory, { estimates: new Set([sanctionsUrl]) })
    const plan = await buildPlan('vet 3 counterparty wallets', {}, deps)
    expect(plan.approach).toMatch(/3 live-quoted, 1 estimated/)
    expect(plan.approach.length).toBeLessThanOrEqual(500)
  })
})
