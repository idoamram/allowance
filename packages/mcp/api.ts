/**
 * The agent's only door into the control plane (C3's frozen routes).
 *
 * Everything here fails loudly and quickly. An MCP tool that hangs is worse than one
 * that errors: the agent is unattended, and a stalled tool call burns the operator's
 * whole session before anyone notices.
 */
import type { PlanInput } from '@planbound/core'

const REQUEST_TIMEOUT_MS = 15_000
/**
 * Paying is a discovery probe, a real x402 purchase and a settlement round trip. On the
 * Hedera rail that is consensus latency plus the facilitator; 15s times out a payment that
 * was about to succeed, which is the one failure here worth spending patience to avoid.
 */
const PAY_TIMEOUT_MS = 90_000

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

/**
 * Like `call`, but hands back a 409 body instead of throwing on it.
 *
 * The gate answers 409 when it blocks a step, and that response is the most informative
 * thing the payment path ever produces — it carries what the human approved, what the
 * seller actually asked, and why the two are irreconcilable. Throwing it away as an error
 * string would turn the product's central mechanism into a stack trace.
 */
async function callAllowing409<T>(
  cfg: ApiConfig,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<{ status: number; body: T }> {
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
      signal: AbortSignal.timeout(PAY_TIMEOUT_MS),
    })
  } catch (cause) {
    throw new Error(
      `control plane unreachable at ${url} — is the app running, and is PLANBOUND_API_URL right? (${
        (cause as Error).message
      })`,
    )
  }

  const text = await res.text()
  if (!res.ok && res.status !== 409) {
    const detail = text.slice(0, 400) || res.statusText
    if (res.status === 401) throw new Error(`401 from ${path}: agent token rejected — ${detail}`)
    throw new Error(`HTTP ${res.status} from ${path}: ${detail}`)
  }
  try {
    return { status: res.status, body: JSON.parse(text) as T }
  } catch {
    throw new Error(`unparseable response from ${path}: ${text.slice(0, 200)}`)
  }
}

export interface GateVerdict {
  ok: boolean
  reason?: 'drift' | 'over_remaining' | 'expired'
  liveAskUsd: number
  quoteUsd: number
  maxAllowedUsd: number
  remainingUsd: number
}

export type PayResponse =
  | { paid: true; data: unknown; paidUsd: number; txRef: string | null }
  | { paid: false; gate: GateVerdict; diffUrl: string; serviceName: string }
  | { paid: false; error: string }

/**
 * POST /api/mcp/steps/pay — the only path money leaves by.
 *
 * Payment is a real network purchase plus a settlement round trip, so it gets a longer
 * budget than the read endpoints. A timeout here is genuinely ambiguous — the seller may
 * have been paid — which is why the step is left pending server-side rather than marked
 * either way.
 */
export async function postStepPay(
  input: { planId: string; stepIdx: number; params?: Record<string, string | number | boolean> },
  cfg: ApiConfig,
  fetchImpl: FetchLike = fetch,
): Promise<PayResponse> {
  const { status, body } = await callAllowing409<Record<string, unknown>>(
    cfg,
    '/api/mcp/steps/pay',
    { method: 'POST', body: JSON.stringify(input) },
    fetchImpl,
  )

  if (status === 409) {
    if (body.gate) {
      return {
        paid: false,
        gate: body.gate as GateVerdict,
        diffUrl: String(body.diffUrl ?? ''),
        serviceName: String(body.serviceName ?? ''),
      }
    }
    // 409 without a gate is a state conflict — already paid, plan not payable — which is
    // a refusal, not a block. Reported as such so the agent does not retry into it.
    return { paid: false, error: String(body.error ?? 'conflict') }
  }

  return {
    paid: true,
    data: body.data,
    paidUsd: Number(body.paidUsd ?? 0),
    txRef: (body.txRef as string | null) ?? null,
  }
}

export interface CloseResult {
  status: string
  sweptUsd?: number
  txRef?: string | null
  [key: string]: unknown
}

/** POST /api/mcp/plans/:id/close — sweep the remainder home and settle. */
export const postClosePlan = (planId: string, cfg: ApiConfig, fetchImpl: FetchLike = fetch) =>
  call<CloseResult>(
    cfg,
    `/api/mcp/plans/${encodeURIComponent(planId)}/close`,
    { method: 'POST' },
    fetchImpl,
  )
