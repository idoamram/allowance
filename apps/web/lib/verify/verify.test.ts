import { describe, expect, it, vi, afterEach } from 'vitest'
import { hashSignal } from '@worldcoin/idkit/hashing'
import { humanVerifier } from './index'
import { noneVerifier } from './none'
import { makeWorldVerifier, planSignal, worldConfigFromEnv, WorldConfigError } from './world'
import { mintStepUpTicket, verifyStepUpTicket } from './ticket'
import type { VerifyPlan } from './types'

const plan = (ceilingUsd: number): VerifyPlan => ({
  planId: 'pl_test',
  ceilingUsd,
  goal: 'vet these 3 counterparty wallets',
})

/** A complete World ID 4.0 registration, as the Portal hands it over. */
const worldEnv = {
  HUMAN_VERIFIER: 'world',
  WORLD_APP_ID: 'app_0000000000000000000000000000',
  WORLD_RP_ID: 'rp_0000000000000000000000000000',
  // 32 bytes of nothing. Never a real key, in a repo that is public.
  WORLD_SIGNER_KEY: '0x' + '11'.repeat(32),
  WORLD_ENV: 'staging',
  STEP_UP_USD: '5',
}

afterEach(() => vi.restoreAllMocks())

describe('verifier selection', () => {
  it('defaults to none, so a clone with an empty env still approves plans', () => {
    expect(humanVerifier({}).id).toBe('none')
  })

  it('never requires step-up under the none verifier, at any ceiling', () => {
    expect(noneVerifier.required(plan(1))).toBe(false)
    expect(noneVerifier.required(plan(10_000))).toBe(false)
  })

  it('refuses to validate a proof it never asked for', async () => {
    const outcome = await noneVerifier.verify({ plan: plan(10), idkitResult: {} })
    expect(outcome.ok).toBe(false)
  })

  it('selects world when asked', () => {
    expect(humanVerifier(worldEnv).id).toBe('world')
  })

  it('names the missing Portal values instead of degrading to none', () => {
    const partial = { HUMAN_VERIFIER: 'world', WORLD_APP_ID: 'app_x' }
    expect(() => humanVerifier(partial)).toThrow(/WORLD_RP_ID, WORLD_SIGNER_KEY/)
  })

  it('rejects an unknown verifier name rather than guessing', () => {
    expect(() => humanVerifier({ HUMAN_VERIFIER: 'orb' })).toThrow(
      /must be "none" or "world"/,
    )
  })
})

describe('world config', () => {
  it('defaults the environment to staging and the preset to proofOfHuman', () => {
    const { WORLD_ENV: _drop, ...rest } = worldEnv as Record<string, string>
    const config = worldConfigFromEnv(rest)
    expect(config.environment).toBe('staging')
    expect(config.preset).toBe('proofOfHuman')
  })

  it('rejects a preset we have not wired', () => {
    expect(() => worldConfigFromEnv({ ...worldEnv, WORLD_PRESET: 'orbLegacy' })).toThrow(
      WorldConfigError,
    )
  })
})

describe('threshold', () => {
  const world = makeWorldVerifier(worldConfigFromEnv(worldEnv))

  it('asks above STEP_UP_USD and stays quiet at or below it', () => {
    expect(world.required(plan(5.01))).toBe(true)
    expect(world.required(plan(5))).toBe(false)
    expect(world.required(plan(0.4))).toBe(false)
  })

  it('reads the threshold from env rather than hardcoding it', () => {
    const strict = makeWorldVerifier(worldConfigFromEnv({ ...worldEnv, STEP_UP_USD: '0' }))
    expect(strict.required(plan(0.02))).toBe(true)
  })
})

describe('challenge', () => {
  const world = makeWorldVerifier(worldConfigFromEnv(worldEnv))

  it('signs server-side and binds the plan into the signal', async () => {
    const challenge = await world.challenge(plan(50))
    if (challenge.kind !== 'world') throw new Error('expected a world challenge')

    expect(challenge.signal).toBe('planbound:pl_test')
    expect(challenge.rpContext.signature).toMatch(/^0x[0-9a-f]{130}$/)
    expect(challenge.rpContext.nonce).toMatch(/^0x00[0-9a-f]{62}$/)
    expect(challenge.rpContext.expires_at).toBeGreaterThan(challenge.rpContext.created_at)
    // The secret stays a secret: nothing the page renders may contain it.
    expect(JSON.stringify(challenge)).not.toContain('1111')
  })
})

describe('verify', () => {
  const config = worldConfigFromEnv(worldEnv)
  const world = makeWorldVerifier(config)
  const okBody = { success: true, nullifier: '0x2bf8' }

  const mockPortal = (body: unknown, status = 200) =>
    vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status }) as Response)

  const idkitResult = (overrides: Record<string, unknown> = {}) => ({
    protocol_version: '4.0',
    nonce: '0xabc',
    action: 'planbound-approve-plan',
    environment: 'staging',
    responses: [{ identifier: 'proof_of_human', nullifier: '0x2bf8', signal_hash: '0x0' }],
    ...overrides,
  })

  it('forwards the payload byte-for-byte to the rp-scoped endpoint', async () => {
    const fetchSpy = mockPortal(okBody)
    const result = idkitResult()
    await world.verify({ plan: plan(50), idkitResult: result })

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://developer.world.org/api/v4/verify/${worldEnv.WORLD_RP_ID}`)
    expect(JSON.parse(init.body as string)).toEqual(result)
  })

  it('accepts a valid proof and reports that no signal came back', async () => {
    mockPortal(okBody)
    const outcome = await world.verify({ plan: plan(50), idkitResult: idkitResult() })
    expect(outcome).toEqual({ ok: true, nullifier: '0x2bf8', signalBound: false })
  })

  it('confirms binding when the credential echoes our plan signal', async () => {
    mockPortal(okBody)
    const outcome = await world.verify({
      plan: plan(50),
      idkitResult: idkitResult({
        responses: [{ nullifier: '0x2bf8', signal_hash: hashSignal(planSignal('pl_test')) }],
      }),
    })
    expect(outcome).toEqual({ ok: true, nullifier: '0x2bf8', signalBound: true })
  })

  it("refuses a proof bound to somebody else's plan", async () => {
    mockPortal(okBody)
    const outcome = await world.verify({
      plan: plan(50),
      idkitResult: idkitResult({
        responses: [{ nullifier: '0x2bf8', signal_hash: hashSignal(planSignal('pl_other')) }],
      }),
    })
    expect(outcome).toMatchObject({ ok: false, code: 'signal_mismatch' })
  })

  it('refuses a production proof when this app is pointed at staging', async () => {
    mockPortal(okBody)
    const outcome = await world.verify({
      plan: plan(50),
      idkitResult: idkitResult({ environment: 'production' }),
    })
    expect(outcome).toMatchObject({ ok: false, code: 'environment_mismatch' })
  })

  it('refuses a proof for a different action', async () => {
    mockPortal(okBody)
    const outcome = await world.verify({
      plan: plan(50),
      idkitResult: idkitResult({ action: 'claim-airdrop' }),
    })
    expect(outcome).toMatchObject({ ok: false, code: 'action_mismatch' })
  })

  it("passes World's own rejection through instead of inventing a message", async () => {
    mockPortal({ success: false, code: 'all_verifications_failed', detail: 'All proof verifications failed.' }, 400)
    const outcome = await world.verify({ plan: plan(50), idkitResult: idkitResult() })
    expect(outcome).toMatchObject({ ok: false, code: 'all_verifications_failed' })
  })

  it('surfaces an unreachable verifier as an error, not a hung spinner', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'))
    const outcome = await world.verify({ plan: plan(50), idkitResult: idkitResult() })
    expect(outcome).toMatchObject({ ok: false, code: 'verifier_unreachable' })
  })
})

describe('step-up ticket', () => {
  const key = 'approval-key-not-a-real-one'

  it('authorises exactly the plan it was minted for', () => {
    const ticket = mintStepUpTicket(key, 'pl_a', 'world')
    expect(verifyStepUpTicket(ticket, key, 'pl_a', 'world').valid).toBe(true)
    expect(verifyStepUpTicket(ticket, key, 'pl_b', 'world').valid).toBe(false)
  })

  it('is worthless under a different approval key or verifier', () => {
    const ticket = mintStepUpTicket(key, 'pl_a', 'world')
    expect(verifyStepUpTicket(ticket, 'other-key-not-a-real-one', 'pl_a', 'world').valid).toBe(false)
    expect(verifyStepUpTicket(ticket, key, 'pl_a', 'none').valid).toBe(false)
  })

  it('expires, so a proof cannot be banked for later', () => {
    const now = Date.now()
    const ticket = mintStepUpTicket(key, 'pl_a', 'world', '', now)
    expect(verifyStepUpTicket(ticket, key, 'pl_a', 'world', now + 9 * 60_000).valid).toBe(true)
    expect(verifyStepUpTicket(ticket, key, 'pl_a', 'world', now + 11 * 60_000).valid).toBe(false)
  })

  it('rejects garbage without throwing', () => {
    expect(verifyStepUpTicket('', key, 'pl_a', 'world').valid).toBe(false)
    expect(verifyStepUpTicket('nonsense', key, 'pl_a', 'world').valid).toBe(false)
    expect(verifyStepUpTicket('9999999999999.', key, 'pl_a', 'world').valid).toBe(false)
  })

  it('carries the nullifier, and the MAC is what vouches for it', () => {
    // The approve path reads this value to decide *which* human proved the plan. If it were
    // merely alongside the ticket rather than signed into it, the client would choose it —
    // and a binding check against a client-chosen identity checks nothing.
    const ticket = mintStepUpTicket(key, 'pl_a', 'world', '0xnull')
    expect(verifyStepUpTicket(ticket, key, 'pl_a', 'world')).toMatchObject({
      valid: true,
      nullifier: '0xnull',
    })

    const [exp, , mac] = ticket.split('.')
    const swapped = `${exp}.${encodeURIComponent('0xsomeone-else')}.${mac}`
    expect(verifyStepUpTicket(swapped, key, 'pl_a', 'world').valid).toBe(false)
  })

  it('reports no nullifier when the verifier returned none, rather than inventing one', () => {
    const ticket = mintStepUpTicket(key, 'pl_a', 'none')
    const check = verifyStepUpTicket(ticket, key, 'pl_a', 'none')
    expect(check.valid).toBe(true)
    expect(check.nullifier).toBeUndefined()
  })
})

describe("hashSignal, against World's published test vectors", () => {
  it('matches the spec at docs.world.org/world-id/idkit/signatures', () => {
    expect(hashSignal('')).toBe('0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4')
    expect(hashSignal('test_signal')).toBe(
      '0x00c1636e0a961a3045054c4d61374422c31a95846b8442f0927ad2ff1d6112ed',
    )
  })
})
