import { describe, expect, it } from 'vitest'
import { discover, quoteSteps, type Candidate } from './discovery'
import demoSellers from './demo-sellers.json'
import { probe } from './x402pay'

// Live-network tests hit the free, keyless Bazaar + seller probes.
// PLANBOUND_SKIP_LIVE=1 skips them (offline dev, flaky wifi).
const live = process.env.PLANBOUND_SKIP_LIVE === '1' ? describe.skip : describe

live('discover (live Bazaar)', () => {
  it('returns ≥3 Base-mainnet candidates for a wallet-risk query', async () => {
    const found = await discover('wallet risk scan', { limit: 5 })
    expect(found.length).toBeGreaterThanOrEqual(3)
    for (const c of found) {
      expect(c.url).toMatch(/^https?:\/\//)
      expect(c.network).toBe('eip155:8453')
      expect(c.name).toBeTruthy()
    }
  }, 30_000)

  it('respects maxUsdPrice', async () => {
    const found = await discover('wallet risk scan', { limit: 10, maxUsdPrice: 0.05 })
    for (const c of found) {
      if (c.priceUsd !== null) expect(c.priceUsd).toBeLessThanOrEqual(0.05)
    }
  }, 30_000)
})

describe('quoteSteps (injected prober — no network)', () => {
  const base = (url: string, priceUsd: number | null): Candidate => ({
    url,
    name: 'svc',
    priceUsd,
    network: 'eip155:8453',
    description: 'd',
  })

  it('marks live 402 quotes as live-402 and uses the probed amount', async () => {
    const steps = await quoteSteps([base('https://a', 0.02)], {
      probe: async () => ({
        amountUsd: 0.05,
        network: 'eip155:8453',
        asset: '0x',
        payTo: '0x',
      }),
      isReachable: async () => true,
    })
    expect(steps).toEqual([
      expect.objectContaining({ source: 'live-402', quoteUsd: 0.05 }),
    ])
  })

  it('falls back to the listed price as an estimate when reachable but no 402', async () => {
    const steps = await quoteSteps([base('https://a', 0.02)], {
      probe: async () => null,
      isReachable: async () => true,
    })
    expect(steps).toEqual([
      expect.objectContaining({ source: 'estimate', quoteUsd: 0.02 }),
    ])
  })

  it('drops dead endpoints and endpoints with no price at all', async () => {
    const steps = await quoteSteps(
      [base('https://dead', 0.02), base('https://alive-but-priceless', null)],
      { probe: async () => null, isReachable: async (u) => !u.includes('dead') },
    )
    expect(steps).toEqual([])
  })
})

live('demo-sellers.json fallback list', () => {
  it('every pinned endpoint still probes alive with a Base 402', async () => {
    const sellers = Object.values(demoSellers).flat()
    expect(sellers.length).toBeGreaterThanOrEqual(8) // ≥2 per category × 4 categories
    const results = await Promise.all(
      sellers.map(async (s) => ({ url: s.url, quote: await probe(s.url) })),
    )
    const dead = results.filter((r) => r.quote === null)
    expect(dead.map((d) => d.url)).toEqual([])
  }, 60_000)
})
