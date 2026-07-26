import 'server-only'
import { db } from '../db'

/**
 * The consent record — and, until Supabase puts a resource in the token, the thing that
 * actually binds an access token to this MCP server.
 *
 * A grant is written by a human on /oauth/consent and by nothing else. That is what makes
 * it a legitimate audience check rather than a rubber stamp: the row says *this person*
 * agreed that *this OAuth client* may act at *this resource*, and a token whose
 * (client_id, sub) has no such row is refused however valid its signature.
 */
export interface Grant {
  id: string
  userId: string
  clientId: string
  resource: string
  scope: string
  agentId: string | null
}

interface GrantRow {
  id: string
  user_id: string
  client_id: string
  resource: string
  scope: string
  agent_id: string | null
}

const toGrant = (row: GrantRow): Grant => ({
  id: row.id,
  userId: row.user_id,
  clientId: row.client_id,
  resource: row.resource,
  scope: row.scope,
  agentId: row.agent_id,
})

/** The live grant for this exact triple, or null. Revoked rows are invisible here. */
export async function liveGrant(
  userId: string,
  clientId: string,
  resource: string,
): Promise<Grant | null> {
  const { data } = await db()
    .from('oauth_grants')
    .select('id, user_id, client_id, resource, scope, agent_id')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .eq('resource', resource)
    .is('revoked_at', null)
    .maybeSingle()

  return data ? toGrant(data as GrantRow) : null
}

/**
 * Record (or refresh) a consent.
 *
 * Written as select-then-write rather than an upsert because the uniqueness that matters is
 * partial — one *live* grant per triple — and a partial index is not something PostgREST can
 * infer a conflict target from. Re-consenting overwrites scope and agent choice in place, so
 * the human's most recent decision is the only one in force.
 */
export async function recordGrant(input: {
  userId: string
  clientId: string
  resource: string
  scope: string
  agentId: string | null
}): Promise<Grant> {
  const existing = await liveGrant(input.userId, input.clientId, input.resource)

  if (existing) {
    const { data, error } = await db()
      .from('oauth_grants')
      .update({ scope: input.scope, agent_id: input.agentId })
      .eq('id', existing.id)
      .select('id, user_id, client_id, resource, scope, agent_id')
      .single()
    if (error) throw new Error(`could not update consent: ${error.message}`)
    return toGrant(data as GrantRow)
  }

  const { data, error } = await db()
    .from('oauth_grants')
    .insert({
      user_id: input.userId,
      client_id: input.clientId,
      resource: input.resource,
      scope: input.scope,
      agent_id: input.agentId,
    })
    .select('id, user_id, client_id, resource, scope, agent_id')
    .single()
  if (error) throw new Error(`could not record consent: ${error.message}`)
  return toGrant(data as GrantRow)
}

/** Withdraw a consent. Tokens already issued stop working at the next request. */
export async function revokeGrant(id: string, userId: string): Promise<void> {
  const { error } = await db()
    .from('oauth_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .is('revoked_at', null)
  if (error) throw new Error(`could not revoke consent: ${error.message}`)
}
