import 'server-only'
import { randomBytes } from 'node:crypto'
import { db } from './db'
import { hashToken } from './ids'

export interface OwnedAgent {
  id: string
  name: string
  ens: string | null
  createdAt: string
  hederaPublicKey: string | null
  planCount: number
}

/**
 * Agent management for a signed-in human.
 *
 * Every function here takes `ownerId` as its first argument and filters on it, and none of
 * them accept an agent that the caller does not own — an unowned id is reported as "not
 * found" rather than as "forbidden", so probing this API tells an attacker nothing about
 * which agent ids exist.
 *
 * These run through the service-role client on purpose. The RLS policies in migration 0004
 * grant `authenticated` read-only access, which is the right ceiling for a browser session
 * but cannot express "issue a token"; writes stay behind this module, where the ownership
 * check is explicit and reviewable in one place.
 */

const AGENT_COLUMNS = 'id, name, ens, created_at, hedera_public_key'

/** `pbt_` prefixed so a leaked token is greppable and obviously ours in a log or a paste. */
const newAgentToken = (): string => `pbt_${randomBytes(24).toString('base64url')}`

interface AgentRow {
  id: string
  name: string
  ens: string | null
  created_at: string
  hedera_public_key: string | null
}

const toOwnedAgent = (row: AgentRow, planCount: number): OwnedAgent => ({
  id: row.id,
  name: row.name,
  ens: row.ens,
  createdAt: row.created_at,
  hederaPublicKey: row.hedera_public_key,
  planCount,
})

export async function listAgents(ownerId: string): Promise<OwnedAgent[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('agents')
    .select(AGENT_COLUMNS)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`could not list agents: ${error.message}`)

  const rows = (data ?? []) as AgentRow[]
  if (rows.length === 0) return []

  // One grouped count rather than a query per agent — the console and this page both
  // render the whole list, so N+1 here is felt immediately.
  const { data: planRows } = await supabase
    .from('plans')
    .select('agent_id')
    .in(
      'agent_id',
      rows.map((r) => r.id),
    )
  const counts = new Map<string, number>()
  for (const { agent_id } of (planRows ?? []) as { agent_id: string }[]) {
    counts.set(agent_id, (counts.get(agent_id) ?? 0) + 1)
  }

  return rows.map((r) => toOwnedAgent(r, counts.get(r.id) ?? 0))
}

/**
 * Creates an agent and returns its bearer token in cleartext **exactly once**. Only the
 * sha256 is stored, so this return value is the single moment the token exists anywhere we
 * control — it is never recoverable afterwards, only replaceable.
 */
export async function createAgent(
  ownerId: string,
  name: string,
): Promise<{ agent: OwnedAgent; token: string }> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('An agent needs a name.')
  if (trimmed.length > 64) throw new Error('That name is too long (64 characters max).')

  const token = newAgentToken()
  const { data, error } = await db()
    .from('agents')
    .insert({ name: trimmed, owner_id: ownerId, token_hash: hashToken(token) })
    .select(AGENT_COLUMNS)
    .single()

  if (error) {
    // `name` is globally unique, so a collision can be another owner's agent. Say only
    // that the name is taken; whose it is, is not this caller's business.
    if (error.code === '23505') throw new Error(`The name "${trimmed}" is already taken.`)
    throw new Error(`could not create agent: ${error.message}`)
  }

  return { agent: toOwnedAgent(data as AgentRow, 0), token }
}

/**
 * Replaces an agent's token. The old one stops working the moment this returns — there is
 * no overlap window, so a running agent will start getting 401s until it is reconfigured.
 * That is the intended behaviour for a revocation: a rotation nobody notices is not one.
 */
export async function rotateAgentToken(
  ownerId: string,
  agentId: string,
): Promise<{ token: string }> {
  const token = newAgentToken()
  const { data, error } = await db()
    .from('agents')
    .update({ token_hash: hashToken(token) })
    .eq('id', agentId)
    .eq('owner_id', ownerId)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`could not rotate token: ${error.message}`)
  if (!data) throw new Error('No such agent.')
  return { token }
}

/**
 * Deletes an agent. `plans.agent_id` cascades, so this takes the agent's plan history with
 * it — including settled plans and their receipts. The confirm step in the UI is the only
 * thing standing between a click and that, which is why it is not optional there.
 */
export async function deleteAgent(ownerId: string, agentId: string): Promise<void> {
  const { data, error } = await db()
    .from('agents')
    .delete()
    .eq('id', agentId)
    .eq('owner_id', ownerId)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`could not delete agent: ${error.message}`)
  if (!data) throw new Error('No such agent.')
}
