import { protectedResourceMetadata } from '@/lib/oauth/metadata'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * RFC 9728 §3.1: for a resource whose identifier has a path, the metadata lives at
 * `/.well-known/oauth-protected-resource` **followed by that path**. This is the URL the
 * 401's `WWW-Authenticate` header points at, and the one a compliant MCP client fetches
 * first. `/.well-known/oauth-protected-resource` (no suffix) answers the same document for
 * clients that only know the plain form.
 */
export const GET = (req: Request) => protectedResourceMetadata(req)

export const OPTIONS = () =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  })
