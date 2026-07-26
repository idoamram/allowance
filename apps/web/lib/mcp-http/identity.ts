import 'server-only'
import { randomBytes } from 'node:crypto'
import { hashToken } from '../ids'
import { db } from '../db'
import type { Grant } from '../oauth/grants'

/**
 * Who the token is, and what the MCP server may use to speak downstream on its behalf.
 *
 * The OAuth subject is a Supabase user id, which is exactly `agents.owner_id` (migration
 * 0004). Turning that into *an agent* is where a remote transport has a decision stdio never
 * had, because a stdio server is launched by one operator with one agent's key in the
 * environment. Here one human may own none, one, or several.
 *
 *   - **none** → refused, 403. There is nothing this token can do; saying so is more useful
 *     than an empty tool result.
 *   - **exactly one** → used.
 *   - **more than one** → refused, 403, listing the candidates — *unless* the human named
 *     one on the consent screen, which is the normal path. Silently picking the first would
 *     mean a plan submitted under an identity nobody chose, and identity is the thing this
 *     product asks people to trust.
 */
export interface AgentIdentity {
  id: string
  name: string
}

export type AgentResolution =
  | { ok: true; agent: AgentIdentity }
  | { ok: false; reason: 'none' | 'ambiguous' | 'stale'; description: string }

export async function resolveAgent(userId: string, grant: Grant): Promise<AgentResolution> {
  const supabase = db()

  if (grant.agentId) {
    // Re-checked against ownership every time: an agent transferred away must stop working
    // immediately, not when the grant is next touched.
    const { data } = await supabase
      .from('agents')
      .select('id, name')
      .eq('id', grant.agentId)
      .eq('owner_id', userId)
      .maybeSingle()
    if (data) return { ok: true, agent: data as AgentIdentity }
    return {
      ok: false,
      reason: 'stale',
      description:
        'the agent this consent was granted for no longer belongs to this account — re-approve the connection to pick another',
    }
  }

  const { data } = await supabase
    .from('agents')
    .select('id, name')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
  const agents = (data ?? []) as AgentIdentity[]

  if (agents.length === 0) {
    return {
      ok: false,
      reason: 'none',
      description:
        'this account owns no agent. Create one (pnpm seed:agent) and re-approve the connection.',
    }
  }
  if (agents.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      description: `this account owns ${agents.length} agents (${agents
        .map((a) => a.name)
        .join(', ')}) and the consent did not name one — re-approve the connection and choose the agent it acts as`,
    }
  }
  return { ok: true, agent: agents[0]! }
}

/**
 * Mint (or reuse) the credential the MCP server uses to call our own control-plane API.
 *
 * This is the token-passthrough rule made concrete. The spec forbids forwarding the
 * client's access token to anything downstream, and our control plane is downstream: it
 * authenticates agents, not humans. So the verified OAuth token is exchanged for a
 * short-lived credential of the server's own, scoped to one agent and one consent, stored
 * only as a hash. The caller's token never leaves this process.
 */
const DELEGATION_TTL_MS = 30 * 60_000
const REUSE_FLOOR_MS = 5 * 60_000

export async function mintDelegation(agentId: string, grantId: string): Promise<string> {
  const token = `pbd_${randomBytes(32).toString('base64url')}`
  const expiresAt = new Date(Date.now() + DELEGATION_TTL_MS)

  const { error } = await db().from('agent_delegations').insert({
    token_hash: hashToken(token),
    agent_id: agentId,
    grant_id: grantId,
    expires_at: expiresAt.toISOString(),
  })
  if (error) throw new Error(`could not mint a downstream credential: ${error.message}`)

  // Opportunistic cleanup: expired rows are dead weight and nothing else prunes them.
  await db()
    .from('agent_delegations')
    .delete()
    .lt('expires_at', new Date(Date.now() - REUSE_FLOOR_MS).toISOString())

  return token
}
