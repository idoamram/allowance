/**
 * The agent's only door into the control plane (C3's frozen routes).
 *
 * Everything here fails loudly and quickly. An MCP tool that hangs is worse than one
 * that errors: the agent is unattended, and a stalled tool call burns the operator's
 * whole session before anyone notices.
 */
import type { PlanInput } from '@planbound/core'

const REQUEST_TIMEOUT_MS = 15_000

export interface ApiConfig {
  baseUrl: string
  token: string
}

export type FetchLike = typeof fetch

/**
 * Read config from the environment, naming exactly what is missing. Values are never
 * logged or echoed — only the variable names appear in errors.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const missing = (['PLANBOUND_API_URL', 'PLANBOUND_AGENT_TOKEN'] as const).filter(
    (k) => !env[k]?.trim(),
  )
  if (missing.length > 0) {
    throw new Error(
      `missing env: ${missing.join(', ')} — copy .env.example to .env.local and fill them in ` +
        '(the agent token is seeded by `pnpm seed:agent`)',
    )
  }
  return {
    baseUrl: env.PLANBOUND_API_URL!.replace(/\/$/, ''),
    token: env.PLANBOUND_AGENT_TOKEN!,
  }
}

async function call<T>(
  cfg: ApiConfig,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<T> {
  const url = `${cfg.baseUrl}${path}`
  let res: Response
  try {
    res = await fetchImpl(url, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.token}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (cause) {
    throw new Error(
      `control plane unreachable at ${url} — is the app running, and is PLANBOUND_API_URL right? (${
        (cause as Error).message
      })`,
    )
  }

  const text = await res.text()
  if (!res.ok) {
    const detail = text.slice(0, 400) || res.statusText
    if (res.status === 401) throw new Error(`401 from ${path}: agent token rejected — ${detail}`)
    throw new Error(`HTTP ${res.status} from ${path}: ${detail}`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`unparseable response from ${path}: ${text.slice(0, 200)}`)
  }
}

export interface SubmitResult {
  planId: string
  approvalUrl: string
}

/** POST /api/mcp/plans — submission is free; approval is what moves money. */
export const postPlan = (plan: PlanInput, cfg: ApiConfig, fetchImpl: FetchLike = fetch) =>
  call<SubmitResult>(cfg, '/api/mcp/plans', { method: 'POST', body: JSON.stringify(plan) }, fetchImpl)

export interface PlanStepView {
  idx: number
  serviceName: string
  serviceUrl: string
  quoteUsd: number
  source: 'live-402' | 'estimate'
  buys: string
  why: string
  rail: string
  status: 'pending' | 'paid' | 'blocked' | 'skipped'
  paidUsd: number | null
  liveAskUsd: number | null
  receipt: unknown
}

export interface PlanView {
  planId: string
  status: string
  goal: string
  approach: string
  totalUsd: number
  ceilingUsd: number
  tolerancePct: number
  expiresAt: string
  steps: PlanStepView[]
  decision: Record<string, unknown> | null
  decisions: Record<string, unknown>[]
  envelope: Record<string, unknown> | null
}

/** GET /api/mcp/plans/:id — status, the human's decision, and the envelope once minted. */
export const getPlan = (planId: string, cfg: ApiConfig, fetchImpl: FetchLike = fetch) =>
  call<PlanView>(cfg, `/api/mcp/plans/${encodeURIComponent(planId)}`, { method: 'GET' }, fetchImpl)
