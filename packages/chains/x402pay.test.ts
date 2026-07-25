import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse402 } from './x402pay'

// Real CoinGecko `payment-required` header, captured live 2026-07-25 (see fixtures/).
const header = readFileSync(
  new URL('./fixtures/coingecko-402.txt', import.meta.url),
  'utf8',
).trim()

const fixtureResponse = () =>
  new Response(null, { status: 402, headers: { 'payment-required': header } })

describe('parse402', () => {
  it('parses the real CoinGecko header: $0.01 USDC on Base, bazaar info inline', () => {
    const q = parse402(fixtureResponse())
    expect(q).not.toBeNull()
    expect(q!.amountUsd).toBe(0.01)
    expect(q!.network).toBe('eip155:8453')
    expect(q!.asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
    expect(q!.payTo).toMatch(/^0x/)
    expect(q!.bazaarInfo?.input).toBeDefined()
  })

  it('prefers the Base entry when accepts[] lists several rails', () => {
    // The fixture itself lists Solana second — Base must win regardless of order.
    const q = parse402(fixtureResponse())
    expect(q!.network).toBe('eip155:8453')
  })

  it('returns null for a response with no payment payload', () => {
    expect(parse402(new Response(null, { status: 402 }))).toBeNull()
  })

  it('falls back to a JSON body when the header is absent', () => {
    const body = JSON.stringify({
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:8453',
          amount: '250000',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          payTo: '0x0000000000000000000000000000000000000001',
          maxTimeoutSeconds: 60,
        },
      ],
    })
    const q = parse402(new Response(null, { status: 402 }), body)
    expect(q!.amountUsd).toBe(0.25)
  })
})
