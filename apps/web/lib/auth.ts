import 'server-only'
import { db } from './db'
import { hashToken } from './ids'

export interface Agent {
  id: string
  name: string
}

/**
 * Agent-side auth: `Authorization: Bearer <token>` matched against the stored sha256.
 * Returns null rather than throwing — callers answer 401 without leaking which part failed.
 */
export async function agentFromRequest(req: Request): Promise<Agent | null> {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  if (!token) return null

  const hash = hashToken(token)

  const { data } = await db()
    .from('agents')
    .select('id, name')
    .eq('token_hash', hash)
    .maybeSingle()
  if (data) return data

  return delegatedAgent(hash)
}

/**
 * The second kind of agent credential: one the remote MCP server minted for itself.
 *
 * A stdio agent holds its own long-lived token from `.env.local`. A remote agent arriving
 * over OAuth holds no such thing — and the MCP authorization spec forbids forwarding the
 * caller's access token downstream, so the HTTP transport exchanges it for a short-lived
 * delegation scoped to one agent and one consent (`lib/mcp-http/identity.ts`). Both kinds
 * resolve to the same `Agent`, so every existing route is unchanged: it still asks "which
 * agent is this" and gets one answer.
 *
 * Expiry is enforced in the query. A delegation past its `expires_at` matches nothing.
 */
async function delegatedAgent(hash: string): Promise<Agent | null> {
  const { data } = await db()
    .from('agent_delegations')
    .select('agents!inner(id, name)')
    .eq('token_hash', hash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  const agent = (data as { agents?: Agent } | null)?.agents
  return agent ?? null
}
