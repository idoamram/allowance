import {
  dispatch,
  isNotification,
  RPC,
  rpcError,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '@planbound/mcp/http'
import { liveToolDeps } from '@planbound/mcp/tools'
import { appOrigin, canonicalResource, resourceMetadataUrl } from '@/lib/oauth/config'
import { challengeResponse } from '@/lib/oauth/errors'
import { liveGrant } from '@/lib/oauth/grants'
import { bearerToken, verifyAccessToken } from '@/lib/oauth/verify'
import { mintDelegation, resolveAgent } from '@/lib/mcp-http/identity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `await_approval` long-polls, and a human deciding whether to fund something is measured in
 * minutes, not seconds. Its own default is 600s; without this the platform's shorter function
 * limit ended the request first and the agent reported a timeout at roughly four minutes —
 * correctly reading it as "nobody has looked yet", but far sooner than it needed to.
 *
 * 300 is the ceiling this plan allows — 800 built fine and then failed at deploy, which is a
 * plan limit rather than a code error. It does not make the tool wait longer than its own
 * `timeoutSec`, and every other tool here returns in well under a second.
 */
export const maxDuration = 300

/**
 * The remote MCP transport: Streamable HTTP, OAuth-protected, same seven tools.
 *
 * The stdio server in `packages/mcp/server.ts` is untouched and remains the demo path. This
 * endpoint exists because authorization only means anything over a remote transport — the
 * MCP spec is explicit that a stdio server should take its credentials from the environment
 * instead. So the difference between the two wires is not the tools; it is that this one has
 * to answer "who is calling, and were they allowed to".
 *
 * Three properties this handler is built around, all of them spec MUSTs:
 *
 *  - **It never redirects.** A browser gets a login page; an MCP client gets a 401 with
 *    `WWW-Authenticate` naming the resource-metadata URL, which is the only thing it can
 *    act on. (`middleware.ts` only redirects `/console` and `/account`, so this route is
 *    already outside it — but the guarantee belongs here, not in a matcher.)
 *  - **It validates the audience.** A token that names a different resource is refused, and
 *    a token with no live consent for *this* server is refused. See `lib/oauth/verify.ts`
 *    for why the check has two layers.
 *  - **It never passes the caller's token on.** The control-plane call it makes downstream
 *    carries a credential this server minted for itself, scoped to one agent and one
 *    consent. The access token stops in this function.
 */

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'www-authenticate, mcp-protocol-version',
}

const badRequest = (message: string) =>
  new Response(JSON.stringify({ error: 'invalid_request', error_description: message }), {
    status: 400,
    headers: JSON_HEADERS,
  })

export async function POST(req: Request) {
  const metadataUrl = resourceMetadataUrl(req)

  // ---- transport-level sanity, before any credential is looked at -----------------
  const negotiated = req.headers.get('mcp-protocol-version')
  if (negotiated && !SUPPORTED_PROTOCOL_VERSIONS.includes(negotiated)) {
    return badRequest(
      `unsupported MCP-Protocol-Version: ${negotiated} (supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')})`,
    )
  }
  if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return badRequest('content-type must be application/json')
  }

  // ---- authorization ---------------------------------------------------------------
  const token = bearerToken(req)
  if (!token) {
    // No credentials at all: RFC 6750 §3.1 says do not send an error code, only the
    // challenge. The client reads `resource_metadata` and starts the flow.
    return challengeResponse(metadataUrl)
  }

  const verified = await verifyAccessToken(token, req)
  if (!verified.ok) {
    return challengeResponse(metadataUrl, {
      error: verified.error,
      description: verified.description,
    })
  }

  const resource = canonicalResource(req)
  const grant = await liveGrant(verified.token.sub, verified.token.clientId, resource)
  if (!grant) {
    // A validly-signed token from our own authorization server that nobody consented to use
    // *here*. That is an audience failure, not a scope failure, so it is 401 — and a 401 is
    // also the answer that makes the client re-run the flow and land on the consent screen.
    return challengeResponse(metadataUrl, {
      error: 'invalid_token',
      description: `no live consent records this client for ${resource} — approve the connection first`,
    })
  }

  const resolved = await resolveAgent(verified.token.sub, grant)
  if (!resolved.ok) {
    return challengeResponse(metadataUrl, {
      error: 'insufficient_scope',
      description: resolved.description,
    })
  }

  // ---- downstream credential: ours, not theirs -------------------------------------
  let delegation: string
  try {
    delegation = await mintDelegation(resolved.agent.id, grant.id)
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: JSON_HEADERS },
    )
  }

  const deps = {
    ...liveToolDeps,
    config: () => ({ baseUrl: appOrigin(req), token: delegation }),
  }

  // ---- the MCP conversation ---------------------------------------------------------
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify(rpcError(null, RPC.parseError, 'body is not valid JSON')), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  const messages = (Array.isArray(body) ? body : [body]) as JsonRpcRequest[]
  if (messages.length === 0 || messages.some((m) => typeof m !== 'object' || m === null)) {
    return new Response(
      JSON.stringify(rpcError(null, RPC.invalidRequest, 'expected a JSON-RPC request object')),
      { status: 400, headers: JSON_HEADERS },
    )
  }

  // Only notifications: nothing to answer, and the spec's answer to that is 202.
  if (messages.every(isNotification)) {
    return new Response(null, { status: 202, headers: JSON_HEADERS })
  }

  const answers: JsonRpcResponse[] = []
  for (const message of messages) {
    const answer = await dispatch(message, deps)
    if (answer) answers.push(answer)
  }

  return new Response(JSON.stringify(Array.isArray(body) ? answers : answers[0]), {
    status: 200,
    headers: { ...JSON_HEADERS, 'mcp-protocol-version': negotiated ?? SUPPORTED_PROTOCOL_VERSIONS[0]! },
  })
}

/**
 * No server-initiated stream. Streamable HTTP permits a server that does not offer one to
 * refuse the GET, and everything these seven tools do is request/response — `await_approval`
 * polls rather than pushes precisely so an unattended agent can never hang on a socket.
 */
export function GET() {
  return new Response(
    JSON.stringify({
      error: 'method_not_allowed',
      error_description: 'this MCP endpoint answers POST only; it opens no server-initiated stream',
    }),
    { status: 405, headers: { ...JSON_HEADERS, allow: 'POST, OPTIONS' } },
  )
}

/** Stateless: there is no session to terminate. */
export const DELETE = GET

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, accept',
      'access-control-expose-headers': 'www-authenticate, mcp-protocol-version',
      'access-control-max-age': '86400',
    },
  })
}
