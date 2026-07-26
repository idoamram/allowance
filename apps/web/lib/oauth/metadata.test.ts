/**
 * The two documents a client with no credentials reads: the 401 challenge and the
 * protected-resource metadata it points at. If either is malformed the client cannot
 * discover anything, and "unauthorized" becomes "broken".
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  authorizationServerMetadataUrl,
  issuer,
  RESOURCE_METADATA_PATH,
  resourceMetadataUrl,
} from './config'
import { challengeResponse, wwwAuthenticate } from './errors'
import { protectedResourceMetadata } from './metadata'

const SUPABASE_URL = 'https://proj-ref.supabase.co'
const APP_URL = 'https://planbound.test'

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
  process.env.APP_URL = APP_URL
})

const req = () => new Request(`${APP_URL}/api/mcp/http`, { method: 'POST' })

describe('protected resource metadata (RFC 9728)', () => {
  it('is well-formed and names exactly one authorization server', async () => {
    const res = protectedResourceMetadata(req())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')

    const body = await res.json()
    expect(body.resource).toBe(`${APP_URL}/api/mcp/http`)
    expect(Array.isArray(body.authorization_servers)).toBe(true)
    expect(body.authorization_servers).toEqual([`${SUPABASE_URL}/auth/v1`])
    expect(body.bearer_methods_supported).toEqual(['header'])
  })

  it('is fetchable cross-origin — browser-hosted clients read it before any token exists', () => {
    expect(protectedResourceMetadata(req()).headers.get('access-control-allow-origin')).toBe('*')
  })

  it("advertises the RFC 8414 location of the issuer's metadata, path component included", () => {
    // The issuer has a path (`/auth/v1`), so its metadata is at
    // <origin>/.well-known/oauth-authorization-server/<path> — the derivation clients get
    // wrong most often, which is why it is stated outright.
    expect(authorizationServerMetadataUrl()).toBe(
      `${SUPABASE_URL}/.well-known/oauth-authorization-server/auth/v1`,
    )
    expect(issuer()).toBe(`${SUPABASE_URL}/auth/v1`)
  })

  it('lives at the path-suffixed well-known URL the challenge points at', () => {
    expect(RESOURCE_METADATA_PATH).toBe('/.well-known/oauth-protected-resource/api/mcp/http')
    expect(resourceMetadataUrl(req())).toBe(`${APP_URL}${RESOURCE_METADATA_PATH}`)
  })
})

describe('WWW-Authenticate (RFC 9728 §5.1)', () => {
  const metadataUrl = `${APP_URL}${RESOURCE_METADATA_PATH}`

  it('always carries resource_metadata — that is what makes a 401 actionable', () => {
    expect(wwwAuthenticate(metadataUrl)).toBe(`Bearer resource_metadata="${metadataUrl}"`)
  })

  it('omits an error code when the request carried no credentials (RFC 6750 §3.1)', async () => {
    const res = challengeResponse(metadataUrl)
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).not.toContain('error=')
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=')
  })

  it('maps the three OAuth errors onto the status codes the MCP spec requires', () => {
    expect(challengeResponse(metadataUrl, { error: 'invalid_token' }).status).toBe(401)
    expect(challengeResponse(metadataUrl, { error: 'insufficient_scope' }).status).toBe(403)
    expect(challengeResponse(metadataUrl, { error: 'invalid_request' }).status).toBe(400)
  })

  it('escapes quotes so a hostile description cannot break out of the header', () => {
    const header = wwwAuthenticate(metadataUrl, {
      error: 'invalid_token',
      description: 'he said "no", then \\ left',
    })
    expect(header).toContain('error_description="he said \\"no\\", then \\\\ left"')
    // One token, then comma-separated auth-params: still a single parseable challenge.
    expect(header.startsWith('Bearer ')).toBe(true)
  })

  it('never caches a challenge', () => {
    expect(challengeResponse(metadataUrl).headers.get('cache-control')).toBe('no-store')
  })
})
