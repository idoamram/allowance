import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StepInput } from '@planbound/core'
import { configFromEnv } from './api'
import {
  _resetApprovalUrls,
  awaitApproval,
  closePlan,
  getEnvelope,
  payAndCall,
  reportDrift,
  submitPlan,
  type ToolDeps,
} from './tools'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A clock the test drives: `sleep` moves it, so polling loops finish instantly. */
function fakeClock(startMs = 1_700_000_000_000) {
  let t = startMs
  return {
    now: () => new Date(t),
    sleep: async (ms: number) => {
      t += ms
    },
    advance: (ms: number) => {
      t += ms
    },
  }
}

function deps(fetchImpl: ToolDeps['fetch'], clock = fakeClock()): ToolDeps {
  return {
    config: () => ({ baseUrl: 'https://plan.test', token: 'tok_test' }),
    fetch: fetchImpl,
    quote: { discover: async () => [], quoteSteps: async () => [] },
    now: clock.now,
    sleep: clock.sleep,
  }
}

const step = (over: Partial<StepInput> = {}): StepInput => ({
  serviceUrl: 'https://seller.example/risk',
  serviceName: 'seller',
  quoteUsd: 0.25,
  source: 'live-402',
  buys: 'a risk score',
  why: 'the cheapest known-bad signal',
  rail: 'worldchain',
  ...over,
})

beforeEach(_resetApprovalUrls)

describe('configFromEnv', () => {
  it('names exactly which variables are missing, and never their values', () => {
    expect(() => configFromEnv({ PLANBOUND_API_URL: 'https://x' } as NodeJS.ProcessEnv)).toThrow(
      /PLANBOUND_AGENT_TOKEN/,
    )
    const cfg = configFromEnv({
      PLANBOUND_API_URL: 'https://x/',
      PLANBOUND_AGENT_TOKEN: 'secret',
    } as NodeJS.ProcessEnv)
    expect(cfg.baseUrl).toBe('https://x') // trailing slash normalised
  })
})

describe('submit_plan', () => {
  it('posts the plan with the bearer token and returns the approval URL', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ planId: 'pl_abc', approvalUrl: 'https://plan.test/p/pl_abc?k=key' }),
    )
    const result = await submitPlan(
      { goal: 'vet 3 wallets', approach: 'four checks', steps: [step()], ceilingUsd: 0.3 },
      deps(fetchImpl as unknown as ToolDeps['fetch']),
    )

    expect(result).toMatchObject({ planId: 'pl_abc', totalUsd: 0.25, ceilingUsd: 0.3 })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://plan.test/api/mcp/plans')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok_test')
    // Defaults are applied here, not guessed by the server.
    expect(JSON.parse(init.body as string)).toMatchObject({ tolerancePct: 20, expiresInMin: 60 })
  })

  it('refuses a ceiling below the step total before any network call', async () => {
    const fetchImpl = vi.fn()
    await expect(
      submitPlan(
        { goal: 'g', approach: 'a', steps: [step({ quoteUsd: 1 })], ceilingUsd: 0.5 },
        deps(fetchImpl as unknown as ToolDeps['fetch']),
      ),
    ).rejects.toThrow(/ceilingUsd/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('surfaces a rejected agent token as a readable error', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'unauthorized' }, 401))
    await expect(
      submitPlan(
        { goal: 'g', approach: 'a', steps: [step()], ceilingUsd: 1 },
        deps(fetchImpl as unknown as ToolDeps['fetch']),
      ),
    ).rejects.toThrow(/agent token rejected/)
  })

  it('reports an unreachable control plane instead of hanging', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed')
    })
    await expect(
      submitPlan(
        { goal: 'g', approach: 'a', steps: [step()], ceilingUsd: 1 },
        deps(fetchImpl as unknown as ToolDeps['fetch']),
      ),
    ).rejects.toThrow(/control plane unreachable/)
  })
})

const planBody = (over: Record<string, unknown> = {}) => ({
  planId: 'pl_abc',
  status: 'pending_approval',
  goal: 'vet 3 wallets',
  approach: 'four checks',
  totalUsd: 0.7,
  ceilingUsd: 1.2,
  tolerancePct: 20,
  expiresAt: new Date(1_700_000_000_000 + 3_600_000).toISOString(),
  steps: [],
  decision: null,
  decisions: [],
  envelope: null,
  ...over,
})

describe('await_approval', () => {
  it('polls until the human decides', async () => {
    const statuses = ['pending_approval', 'pending_approval', 'approved']
    const fetchImpl = vi.fn(async () =>
      json(
        planBody({
          status: statuses.shift() ?? 'approved',
          decision: { outcome: 'approved' },
        }),
      ),
    )
    const result = await awaitApproval(
      { planId: 'pl_abc', timeoutSec: 60 },
      deps(fetchImpl as unknown as ToolDeps['fetch']),
    )
    expect(result.status).toBe('approved')
    expect(result.timedOut).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('times out without hanging, and does not call that a rejection', async () => {
    const fetchImpl = vi.fn(async () => json(planBody()))
    const result = await awaitApproval(
      { planId: 'pl_abc', timeoutSec: 9 },
      deps(fetchImpl as unknown as ToolDeps['fetch']),
    )
    expect(result).toMatchObject({ status: 'pending_approval', timedOut: true, waitedSec: 9 })
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('reports a rejection with the reason the human typed', async () => {
    const fetchImpl = vi.fn(async () =>
      json(
        planBody({
          status: 'rejected',
          decision: { outcome: 'rejected', target: 'price', reason: 'too expensive for a scan' },
        }),
      ),
    )
    const result = await awaitApproval(
      { planId: 'pl_abc' },
      deps(fetchImpl as unknown as ToolDeps['fetch']),
    )
    expect(result.decision).toMatchObject({ outcome: 'rejected', target: 'price' })
  })
})

describe('tools that need money they do not have yet', () => {
  it('get_envelope says not_implemented while no envelope has been minted', async () => {
    const fetchImpl = vi.fn(async () => json(planBody({ status: 'approved' })))
    const result = await getEnvelope(
      { planId: 'pl_abc' },
      deps(fetchImpl as unknown as ToolDeps['fetch']),
    )
    expect(result).toMatchObject({ status: 'not_implemented', planStatus: 'approved' })
  })

  it('get_envelope returns the row as soon as one exists', async () => {
    const envelope = { plan_id: 'pl_abc', hedera_account: '0.0.1234', funded_usd: 1.2 }
    const fetchImpl = vi.fn(async () => json(planBody({ status: 'approved', envelope })))
    const result = await getEnvelope(
      { planId: 'pl_abc' },
      deps(fetchImpl as unknown as ToolDeps['fetch']),
    )
    expect(result).toMatchObject({ status: 'ok', envelope })
  })

  it('pay_and_call and close_plan refuse rather than fake a receipt', async () => {
    const d = deps(vi.fn() as unknown as ToolDeps['fetch'])
    expect(await payAndCall({ planId: 'pl_abc', stepIdx: 0 }, d)).toMatchObject({
      status: 'not_implemented',
      tool: 'pay_and_call',
    })
    expect(await closePlan({ planId: 'pl_abc' }, d)).toMatchObject({
      status: 'not_implemented',
      tool: 'close_plan',
    })
  })
})

describe('report_drift', () => {
  // The v1.3 demo numbers: $0.70 quoted, $1.20 ceiling, three steps paid ($0.60),
  // the estimated sanctions step asks $0.50 against a $0.10 estimate.
  const driftPlan = planBody({
    status: 'executing',
    steps: [
      { idx: 0, quoteUsd: 0.25, status: 'paid', paidUsd: 0.25, source: 'live-402' },
      { idx: 1, quoteUsd: 0.2, status: 'paid', paidUsd: 0.2, source: 'live-402' },
      { idx: 2, quoteUsd: 0.15, status: 'paid', paidUsd: 0.15, source: 'live-402' },
      { idx: 3, quoteUsd: 0.1, status: 'pending', paidUsd: null, source: 'estimate' },
    ],
    envelope: { funded_usd: 1.2 },
  })

  it('blocks on drift and prices the three exits exactly as the server gate would', async () => {
    const fetchImpl = vi.fn(async () => json(driftPlan))
    const result = await reportDrift(
      { planId: 'pl_abc', stepIdx: 3, liveAskUsd: 0.5 },
      deps(fetchImpl as unknown as ToolDeps['fetch']),
    )
    expect(result.gate).toMatchObject({ ok: false, reason: 'drift', maxAllowedUsd: 0.12 })
    expect(result.exits).toEqual({ topUpUsd: 0, abortReturnsUsd: 0.6, newTotalUsd: 1.1 })
    expect(result.recorded).toBe(false)
  })

  it('carries the approval key into the diff link for a plan this process submitted', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).endsWith('/api/mcp/plans')
        ? json({ planId: 'pl_abc', approvalUrl: 'https://plan.test/p/pl_abc?k=key' })
        : json(driftPlan),
    )
    const d = deps(fetchImpl as unknown as ToolDeps['fetch'])
    await submitPlan({ goal: 'g', approach: 'a', steps: [step()], ceilingUsd: 1 }, d)
    const result = await reportDrift({ planId: 'pl_abc', stepIdx: 3, liveAskUsd: 0.5 }, d)
    expect(result.diffUrl).toBe('https://plan.test/p/pl_abc?k=key&drift=3')
  })

  it('never mints an approval link it does not have the key for', async () => {
    const fetchImpl = vi.fn(async () => json(driftPlan))
    const result = await reportDrift(
      { planId: 'pl_abc', stepIdx: 3, liveAskUsd: 0.5 },
      deps(fetchImpl as unknown as ToolDeps['fetch']),
    )
    expect(result.diffUrl).toBe('https://plan.test/p/pl_abc')
    expect(result.note).toMatch(/original approval link/)
  })
})
