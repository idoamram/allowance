import { authorizationServerMetadataUrl, canonicalResource, issuer } from './config'

/**
 * The RFC 9728 protected-resource metadata document.
 *
 * This is the one thing an MCP client is guaranteed to read before it has any credential,
 * so it is the whole configuration surface: it names this server's canonical URI (which is
 * what the client must send back as `resource`) and the issuer of the authorization server
 * that mints tokens for it. Everything else — endpoints, registration, supported PKCE
 * methods — the client discovers from the authorization server itself, which is why only
 * the issuer appears here.
 *
 * Publicly cacheable and CORS-open on purpose: it contains no secrets, and browser-hosted
 * MCP clients have to be able to fetch it cross-origin.
 */
export function protectedResourceMetadata(req: Request): Response {
  const body = {
    resource: canonicalResource(req),
    authorization_servers: [issuer()],
    // Not part of RFC 9728, but the issuer has a path component and RFC 8414's derivation
    // rule for that case trips up more than one client. Naming the document outright costs
    // one field and removes a guess.
    authorization_server_metadata_endpoints: [authorizationServerMetadataUrl()],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'profile', 'email'],
    resource_name: 'PlanBound MCP',
    resource_documentation: 'https://github.com/idoamram/planbound',
  }

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=300',
    },
  })
}
