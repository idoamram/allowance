/**
 * The three answers a protected resource is allowed to give when authorization fails, and
 * the one header that makes them actionable.
 *
 * An MCP client cannot act on a redirect to a login page. What it can act on is a 401
 * carrying `WWW-Authenticate` with `resource_metadata` (RFC 9728 §5.1): that one string is
 * how a client with no prior knowledge of this server discovers the authorization server,
 * registers, and comes back with a token. Getting the header right is the difference
 * between "needs configuration" and "connects on its own".
 */

/** RFC 6750 §3.1 error codes, restricted to the three the MCP spec maps to status codes. */
export type OAuthErrorCode = 'invalid_token' | 'insufficient_scope' | 'invalid_request'

const STATUS: Record<OAuthErrorCode, number> = {
  invalid_token: 401,
  insufficient_scope: 403,
  invalid_request: 400,
}

/**
 * Header values are ByteStrings: every character has to fit in one byte, and the platform
 * throws rather than mangling one that does not. Our prose is written with em dashes and
 * curly quotes, so a description built from it will kill the response — and it would do it
 * on the *error* path, turning a clean 401 into a 500 exactly when a client is trying to
 * discover us. The readable text still reaches the caller in the JSON body; the header gets
 * an ASCII rendering of it.
 */
const asciiOnly = (value: string) =>
  value
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    // Anything still outside printable ASCII (including CR/LF, which would split the
    // header) is dropped rather than guessed at.
    .replace(/[^\x20-\x7e]/g, '')

/** `quoted-string` per RFC 9110: backslash and double quote are the only escapes. */
const quote = (value: string) =>
  `"${asciiOnly(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export interface ChallengeOptions {
  /**
   * Omitted for a request that carried no credentials at all. RFC 6750 §3.1 is explicit:
   * a client that simply has not authenticated yet should not be told its token is
   * invalid, because it never sent one.
   */
  error?: OAuthErrorCode
  description?: string
  scope?: string
}

/**
 * Build the challenge. `resource_metadata` is always present — it is the whole point of
 * answering 401 rather than 404, and RFC 9728 §5.1 requires it here.
 */
export function wwwAuthenticate(resourceMetadataUrl: string, opts: ChallengeOptions = {}): string {
  const params: string[] = []
  if (opts.error) params.push(`error=${quote(opts.error)}`)
  if (opts.description) params.push(`error_description=${quote(opts.description)}`)
  if (opts.scope) params.push(`scope=${quote(opts.scope)}`)
  params.push(`resource_metadata=${quote(resourceMetadataUrl)}`)
  return `Bearer ${params.join(', ')}`
}

/**
 * A JSON body accompanies the challenge so a human reading `curl -v` learns the same thing
 * the client learns from the header. The body never names which check failed beyond the
 * OAuth error code: "expired" versus "wrong audience" is a probing oracle.
 */
export function challengeResponse(
  resourceMetadataUrl: string,
  opts: ChallengeOptions = {},
): Response {
  const status = opts.error ? STATUS[opts.error] : 401
  return new Response(
    JSON.stringify({
      error: opts.error ?? 'unauthorized',
      error_description: opts.description ?? 'authorization required',
      resource_metadata: resourceMetadataUrl,
    }),
    {
      status,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': wwwAuthenticate(resourceMetadataUrl, opts),
        'cache-control': 'no-store',
      },
    },
  )
}
