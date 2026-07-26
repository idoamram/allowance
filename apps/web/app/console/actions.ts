'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { supabaseServer, requireUser } from '@/lib/supabase/server'
import { createAgent, rotateAgentToken, deleteAgent } from '@/lib/accounts'

/**
 * The result of the two actions that mint a bearer token.
 *
 * `token` travels exactly once: server action result → React state → the reveal panel.
 * It is never written to a cookie, a query string, a log line, or the database — only its
 * sha256 is stored, so nothing downstream can show it again.
 */
export type TokenState = {
  token?: string
  /** Names the agent the token belongs to, so a reveal is never ambiguous. */
  agentName?: string
  error?: string
}

export type PlainState = { error?: string }

/** Never surface a raw exception to the page — it can carry connection strings. */
function reason(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : ''
  if (/duplicate|unique/i.test(message)) return 'You already have an agent with that name.'
  return fallback
}

export async function createAgentAction(_prev: TokenState, form: FormData): Promise<TokenState> {
  const user = await requireUser()
  const name = String(form.get('name') ?? '').trim()
  if (name.length < 2) return { error: 'Give the agent a name — at least two characters.' }
  if (name.length > 60) return { error: 'That name is too long. Keep it under 60 characters.' }

  try {
    const { agent, token } = await createAgent(user.id, name)
    revalidatePath('/console')
    return { token, agentName: agent.name }
  } catch (e) {
    return { error: reason(e, 'The agent could not be created. Try again.') }
  }
}

export async function rotateAgentTokenAction(
  _prev: TokenState,
  form: FormData,
): Promise<TokenState> {
  const user = await requireUser()
  const agentId = String(form.get('agentId') ?? '')
  const agentName = String(form.get('agentName') ?? '')
  if (!agentId) return { error: 'That agent could not be identified. Reload the page.' }

  try {
    const { token } = await rotateAgentToken(user.id, agentId)
    revalidatePath('/console')
    return { token, agentName }
  } catch (e) {
    return { error: reason(e, 'The token could not be rotated. Try again.') }
  }
}

export async function deleteAgentAction(_prev: PlainState, form: FormData): Promise<PlainState> {
  const user = await requireUser()
  const agentId = String(form.get('agentId') ?? '')
  if (!agentId) return { error: 'That agent could not be identified. Reload the page.' }

  try {
    await deleteAgent(user.id, agentId)
    revalidatePath('/console')
    return {}
  } catch (e) {
    return { error: reason(e, 'The agent could not be deleted. Try again.') }
  }
}

export async function signOutAction(): Promise<void> {
  const supabase = await supabaseServer()
  await supabase.auth.signOut()
  redirect('/login')
}
