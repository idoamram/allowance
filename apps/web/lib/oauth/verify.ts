/**
 * Token validation for the MCP resource server.
 *
 * Two things this file refuses to do, both of them the reason it exists:
 *
 *  1. **It will not accept a token it cannot tie to this server.** The MCP authorization
 *     spec's hardest requirement is that a resource server reject tokens minted for
 *     somebody else — otherwise a token a user granted to an unrelated app is replayable
 *     here.
 *
 *     Verified against the live Supabase OAuth server, 2026-07-26, by running the whole
 *     flow: the `resource` parameter (RFC 8707) is *accepted* on both the authorization
 *     and token requests — it does not break the flow — but it is not reflected anywhere
 *     in the issued token. The access token's claims are `iss, sub, aud, exp, iat, email,
 *     role, aal, amr, session_id, client_id, scope`, and `aud` is the Postgres role
 *     `"authenticated"`, not a resource URI.
 *
 *     So the audience is established in two layers: any resource-shaped `aud` entry that
 *     *is* present must be this server's canonical URI, and the caller must additionally
 *     hold a live consent grant for that URI (`grants.ts`). The second layer is what binds
 *     today — it is the spec's "or otherwise verify that they are the intended recipient"
 *     branch, and it is a stronger record than a claim, because a human wrote it. The first
 *     starts binding the moment a resource appears in the token, with no change here.
 *  2. **It will not accept a token that is not an OAuth token.** A Supabase magic-link
 *     session JWT is signed by the same keys and carries the same issuer. What it does not
 *     carry is `client_id` — confirmed live against both kinds of token. Requiring that
 *     claim is what stops a browser session cookie, stolen or simply pasted by a confused
 *     operator, from being usable as an agent credential.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import { authServerMetadata, canonicalResource, issuer } from './config'
import type { OAuthErrorCode } from './errors'

/** Asymmetric only. An HS256 token would be verifiable by anyone holding the JWT secret. */
const ALLOWED_ALGS = ['ES256', 'RS256', 'EdDSA']

export interface VerifiedToken {
  /** Supabase user id — the same value as `agents.owner_id`. */
  sub: string
  clientId: string
  scopes: string[]
  expiresAt: number
  /**
   * `token-claim` when the token itself named this resource; `consent-grant` when the
   * binding rests on the recorded consent instead. Surfaced so the distinction is visible
   * in review and in logs rather than buried in a comment.
   */
  audienceBinding: 'token-claim' | 'consent-grant'
}

export type VerifyResult =
  | { ok: true; token: VerifiedToken }
  | { ok: false; error: OAuthErrorCode; description: string }

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

/** Test seam — the JWKS cache is module state and must not cross cases. */
export const _resetJwksCache = () => jwks.clear()

/**
 * One key set per JWKS URI, cached for the process. `createRemoteJWKSet` re-fetches on an
 * unknown `kid` (rate-limited by `cooldownDuration`), which is how key rotation is handled
 * without a fetch per request.
 */
function keySet(uri: string) {
  let set = jwks.get(uri)
  if (!set) {
    set = createRemoteJWKSet(new URL(uri), {
      cacheMaxAge: 10 * 60_000,
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    })
    jwks.set(uri, set)
  }
  return set
}

const asArray = (aud: JWTPayload['aud']): string[] =>
  aud === undefined ? [] : Array.isArray(aud) ? aud : [aud]

/** An `aud` entry that names a resource rather than a Postgres role. */
const isResourceUri = (value: string) => /^https?:\/\//i.test(value)

/** The `Authorization: Bearer <token>` value, or null. Tokens in query strings are refused. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header) return null
  const [scheme, ...rest] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return null
  const token = rest.join(' ').trim()
  return token.length > 0 ? token : null
}

/**
 * Injectable so the security properties can be tested without a network: a test supplies a
 * local key set and a stub discovery fetch, and exercises the same code path production
 * runs. Both default to the real thing.
 */
export interface VerifyDeps {
  fetch?: typeof fetch
  keys?: (jwksUri: string) => JWTVerifyGetKey
}

export async function verifyAccessToken(
  token: string,
  req?: Request,
  deps: VerifyDeps = {},
): Promise<VerifyResult> {
  const fetchImpl = deps.fetch ?? fetch
  const resolveKeys = deps.keys ?? keySet
  const expectedIssuer = issuer()
  const resource = canonicalResource(req)

  let metadata
  try {
    metadata = await authServerMetadata(fetchImpl)
  } catch (error) {
    // Discovery is down, so nothing can be verified. Failing closed is the only safe
    // answer; failing open here would accept every token during an outage.
    return {
      ok: false,
      error: 'invalid_token',
      description: `cannot reach the authorization server to verify this token: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }

  let payload: JWTPayload
  try {
    const verified = await jwtVerify(token, resolveKeys(metadata.jwks_uri), {
      issuer: expectedIssuer,
      algorithms: ALLOWED_ALGS,
      clockTolerance: 5,
    })
    payload = verified.payload
  } catch (error) {
    return {
      ok: false,
      error: 'invalid_token',
      description: `token rejected: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const audiences = asArray(payload.aud)
  const resourceAudiences = audiences.filter(isResourceUri)
  if (resourceAudiences.length > 0 && !resourceAudiences.includes(resource)) {
    return {
      ok: false,
      error: 'invalid_token',
      description: `token audience ${resourceAudiences.join(', ')} does not include this MCP server (${resource})`,
    }
  }

  const clientId = typeof payload.client_id === 'string' ? payload.client_id.trim() : ''
  if (!clientId) {
    return {
      ok: false,
      error: 'invalid_token',
      description:
        'token carries no client_id, so it was not issued through the OAuth flow for this server — a session token is not an agent credential',
    }
  }

  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  if (!sub) {
    return { ok: false, error: 'invalid_token', description: 'token carries no subject' }
  }

  const scopes =
    typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : []

  return {
    ok: true,
    token: {
      sub,
      clientId,
      scopes,
      expiresAt: (payload.exp ?? 0) * 1000,
      audienceBinding: resourceAudiences.includes(resource) ? 'token-claim' : 'consent-grant',
    },
  }
}
