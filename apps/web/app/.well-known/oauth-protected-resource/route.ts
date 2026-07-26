import { protectedResourceMetadata } from '@/lib/oauth/metadata'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The path-less form of the same document. RFC 9728 puts the metadata for a resource with a
 * path at the suffixed URL, and that is what our 401 advertises — but clients in the wild
 * still probe the bare well-known path, and answering it costs nothing and saves a round of
 * "why won't it connect".
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
