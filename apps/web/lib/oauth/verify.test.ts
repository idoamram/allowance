/**
 * The security properties of the resource server, tested as properties rather than as a
 * happy path. Every case here is a token that *is* validly signed by the right issuer —
 * what separates them is whether they were issued for this MCP server. That is the
 * distinction the MCP spec calls a MUST and the one an attacker exercises.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose'
import { _resetDiscoveryCache, canonicalResource, issuer } from './config'
import { _resetJwksCache, bearerToken, verifyAccessToken } from './verify'

const SUPABASE_URL = 'https://proj-ref.supabase.co'
const APP_URL = 'https://planbound.test'

let privateKey: CryptoKey
let publicJwk: JWK

const discovery = () =>
  ({
    issuer: `${SUPABASE_URL}/auth/v1`,
    jwks_uri: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  }) as const

/** Stands in for the authorization server's metadata endpoint. */
const stubFetch = (body: unknown = discovery()): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch

const deps = (body?: unknown) => ({
  fetch: stubFetch(body),
  keys: () => createLocalJWKSet({ keys: [publicJwk] }),
})

async function mint(claims: Record<string, unknown>, opts: { alg?: string; exp?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg ?? 'ES256' })
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(privateKey)
}

const good = () => ({
  iss: `${SUPABASE_URL}/auth/v1`,
  sub: '3f1d0d2a-0000-4000-8000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  client_id: 'e1a5c0de-0000-4000-8000-00000000abcd',
  scope: 'openid email',
})

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
  process.env.APP_URL = APP_URL
  _resetDiscoveryCache()
  _resetJwksCache()
  const pair = await generateKeyPair('ES256', { extractable: true })
  privateKey = pair.privateKey
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', use: 'sig' }
})

describe('canonical resource identity', () => {
  it('is absolute, lowercase and has no trailing slash (RFC 8707 §2)', () => {
    expect(canonicalResource()).toBe(`${APP_URL}/api/mcp/http`)
    process.env.APP_URL = 'HTTPS://PlanBound.TEST/'
    expect(canonicalResource()).toBe(`${APP_URL}/api/mcp/http`)
  })

  it('derives the issuer from env, never from a literal', () => {
    expect(issuer()).toBe(`${SUPABASE_URL}/auth/v1`)
  })
})

describe('bearerToken', () => {
  it('reads the Authorization header case-insensitively', () => {
    const req = new Request('https://x/', { headers: { authorization: 'bEaReR abc.def.ghi' } })
    expect(bearerToken(req)).toBe('abc.def.ghi')
  })

  it('ignores a token in the query string — the spec forbids that placement', () => {
    const req = new Request('https://x/?access_token=abc')
    expect(bearerToken(req)).toBeNull()
  })

  it('rejects a non-Bearer scheme', () => {
    const req = new Request('https://x/', { headers: { authorization: 'Basic abc' } })
    expect(bearerToken(req)).toBeNull()
  })
})

describe('verifyAccessToken', () => {
  it('accepts a token from our authorization server issued to an OAuth client', async () => {
    const result = await verifyAccessToken(await mint(good()), undefined, deps())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.token.sub).toBe(good().sub)
    expect(result.token.clientId).toBe(good().client_id)
    expect(result.token.scopes).toEqual(['openid', 'email'])
    // Supabase puts the Postgres role in `aud`, so nothing in the token names this server;
    // the binding is the recorded consent, and the result says so out loud.
    expect(result.token.audienceBinding).toBe('consent-grant')
  })

  it('REJECTS a token whose audience names a different resource', async () => {
    const token = await mint({ ...good(), aud: ['authenticated', 'https://evil.example/mcp'] })
    const result = await verifyAccessToken(token, undefined, deps())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('invalid_token')
    expect(result.description).toContain('does not include this MCP server')
  })

  it('accepts — and reports as token-bound — an audience that names this server', async () => {
    const token = await mint({
      ...good(),
      aud: ['authenticated', `${APP_URL}/api/mcp/http`],
    })
    const result = await verifyAccessToken(token, undefined, deps())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.token.audienceBinding).toBe('token-claim')
  })

  it('REJECTS a session token: same signer, same issuer, no client_id', async () => {
    const { client_id: _dropped, ...session } = good()
    const result = await verifyAccessToken(await mint(session), undefined, deps())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('invalid_token')
    expect(result.description).toContain('client_id')
  })

  it('REJECTS a token from another issuer', async () => {
    const token = await mint({ ...good(), iss: 'https://someone-else.supabase.co/auth/v1' })
    const result = await verifyAccessToken(token, undefined, deps())
    expect(result.ok).toBe(false)
  })

  it('REJECTS an expired token', async () => {
    const token = await mint(good(), { exp: '-1m' })
    const result = await verifyAccessToken(token, undefined, deps())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('invalid_token')
  })

  it('REJECTS a garbage token', async () => {
    const result = await verifyAccessToken('not-a-jwt', undefined, deps())
    expect(result.ok).toBe(false)
  })

  it('fails closed when discovery names an unexpected issuer', async () => {
    const result = await verifyAccessToken(
      await mint(good()),
      undefined,
      deps({ issuer: 'https://attacker.example/auth/v1', jwks_uri: 'https://attacker.example/j' }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.description).toContain('cannot reach the authorization server')
  })

  it('binds the audience to the request origin when APP_URL is unset', async () => {
    delete process.env.APP_URL
    const req = new Request('https://other-host.test/api/mcp/http', { method: 'POST' })
    const token = await mint({ ...good(), aud: ['authenticated', `${APP_URL}/api/mcp/http`] })
    // The token names planbound.test; the request arrived at other-host.test.
    const result = await verifyAccessToken(token, req, deps())
    expect(result.ok).toBe(false)
  })
})
