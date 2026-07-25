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

  const { data } = await db()
    .from('agents')
    .select('id, name')
    .eq('token_hash', hashToken(token))
    .maybeSingle()

  return data ?? null
}
