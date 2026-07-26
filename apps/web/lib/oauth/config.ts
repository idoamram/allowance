/**
 * Where this resource server lives, and where its authorization server lives.
 *
 * Every identifier resolves from env. The repo is public and the Supabase project ref is
 * an identifier like any other: it appears in `NEXT_PUBLIC_SUPABASE_URL` and nowhere in
 * source. A cloner points that at their own project and the whole OAuth surface follows.
 */

/**
 * The MCP endpoint's path. This is the resource identifier's path component, so it is also
 * the suffix of the protected-resource metadata URL (RFC 9728 §3.1) — the two must move
 * together, which is why they are derived from one constant.
 */
export const MCP_PATH = '/api/mcp/http'

export const RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`

/** Scopes we ask Supabase for. Its OAuth server publishes exactly these four. */
export const REQUIRED_SCOPES = ['openid'] as const

const stripSlash = (u: string) => u.replace(/\/+$/, '')

/**
 * The origin this deployment answers on.
 *
 * `APP_URL` wins when set, because the canonical resource URI has to be stable: a client
 * that got a token for `https://planbound.xyz/api/mcp/http` must not be refused because a
 * proxy rewrote the Host header on the next hop. Falling back to the request origin keeps
 * local development on any port working without configuration.
 */
export function appOrigin(req?: Request): string {
  const configured = process.env.APP_URL?.trim()
  if (configured) return stripSlash(configured)
  if (req) return new URL(req.url).origin
  throw new Error('APP_URL must be set, or an origin must be derivable from the request')
}

/**
 * The canonical URI of this MCP server, per RFC 8707 §2: absolute, lowercase scheme and
 * host, no fragment, no trailing slash. This exact string is what clients send as
 * `resource`, what the metadata document advertises, and what a token is checked against.
 */
export function canonicalResource(req?: Request): string {
  const origin = appOrigin(req)
  const url = new URL(origin)
  url.protocol = url.protocol.toLowerCase()
  url.hostname = url.hostname.toLowerCase()
  return `${stripSlash(url.origin)}${MCP_PATH}`
}

export function resourceMetadataUrl(req?: Request): string {
  return `${appOrigin(req)}${RESOURCE_METADATA_PATH}`
}

/** The Supabase project URL — the same value the browser client already uses. */
export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL must be set (see .env.example)')
  return stripSlash(url)
}

/** Supabase Auth is the authorization server; its issuer is the `/auth/v1` base. */
export function issuer(): string {
  return `${supabaseUrl()}/auth/v1`
}

/**
 * RFC 8414 places the metadata for an issuer with a path at
 * `<origin>/.well-known/oauth-authorization-server/<path>`, which is where Supabase serves
 * it. Advertised in the protected-resource document so a client never has to guess.
 */
export function authorizationServerMetadataUrl(): string {
  return `${new URL(supabaseUrl()).origin}/.well-known/oauth-authorization-server/auth/v1`
}

export interface AuthServerMetadata {
  issuer: string
  jwks_uri: string
  authorization_endpoint?: string
  token_endpoint?: string
  registration_endpoint?: string
  scopes_supported?: string[]
}

const DISCOVERY_TTL_MS = 10 * 60_000
let cached: { at: number; value: AuthServerMetadata } | null = null

/** Test seam — module-level caches must not leak between cases. */
export const _resetDiscoveryCache = () => {
  cached = null
}

/**
 * Read the authorization server's own metadata rather than composing its endpoints here.
 * That is what the discovery document is for: if Supabase moves a path, we follow it
 * instead of breaking. The issuer is checked against the one we expect, because a metadata
 * document that names a different issuer is either a misconfiguration or an attack, and
 * both should stop here.
 */
export async function authServerMetadata(
  fetchImpl: typeof fetch = fetch,
): Promise<AuthServerMetadata> {
  const now = Date.now()
  if (cached && now - cached.at < DISCOVERY_TTL_MS) return cached.value

  const res = await fetchImpl(authorizationServerMetadataUrl(), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  })
  if (!res.ok) throw new Error(`authorization server metadata unavailable: HTTP ${res.status}`)

  const value = (await res.json()) as AuthServerMetadata
  if (value.issuer !== issuer()) {
    throw new Error(
      `authorization server metadata names issuer ${value.issuer}, expected ${issuer()}`,
    )
  }
  if (!value.jwks_uri) throw new Error('authorization server metadata has no jwks_uri')

  cached = { at: now, value }
  return value
}
