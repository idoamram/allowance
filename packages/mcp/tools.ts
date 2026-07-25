/**
 * The seven MCP tools, as plain functions. `server.ts` is only the wire.
 *
 * Split this way so the tools are unit-testable without a transport: every dependency
 * that touches the world — HTTP, discovery, the clock, sleeping — arrives in `deps`.
 *
 * Three tools answer `not_implemented` today. That is a deliberate honesty choice over
 * a plausible-looking stub: `pay_and_call`, `get_envelope` and `close_plan` all need
 * money that does not exist until T7/T9/T11 mint, gate and sweep an envelope. An agent
 * that gets `not_implemented` stops; an agent that gets a fake receipt lies to a human.
 */
import { driftExits, gate, totalUsd, type GateResult, type PlanInput, type StepInput } from '@planbound/core'
import { planInputSchema } from '@planbound/core'
import { buildPlan, liveDeps, type QuoteDeps, type QuotedPlan } from './plan'
import {
  configFromEnv,
  getPlan,
  postPlan,
  type ApiConfig,
  type FetchLike,
  type PlanView,
} from './api'

const POLL_INTERVAL_MS = 3_000
const DEFAULT_TOLERANCE_PCT = 20
const DEFAULT_EXPIRES_IN_MIN = 60

export interface ToolDeps {
  config: () => ApiConfig
  fetch: FetchLike
  quote: QuoteDeps
  now: () => Date
  sleep: (ms: number) => Promise<void>
}

export const liveToolDeps: ToolDeps = {
  config: () => configFromEnv(),
  fetch,
  quote: liveDeps,
  now: () => new Date(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

/**
 * planId → the approval URL we were handed at submit time. The approval key lives in
 * that URL and nowhere else the agent can reach, so a drift diff link can only be built
 * for a plan this process submitted. When it can't, we say so rather than mint a link
 * that would 403 the human.
 */
const approvalUrls = new Map<string, string>()

/** Test seam — the map is process-local state, and tests must not inherit each other's. */
export const _resetApprovalUrls = () => approvalUrls.clear()

const notImplemented = (tool: string, lands: string) => ({
  status: 'not_implemented' as const,
  tool,
  reason: `${tool} needs a funded envelope, which lands in ${lands}. Nothing is faked in the meantime.`,
})

// ---------------------------------------------------------------- quote_task

export interface QuoteTaskInput {
  goal: string
  maxUsdPerStep?: number
}

/** Shop the task: discover real sellers, probe them for real prices, self-check, compose. */
export async function quoteTask(
  input: QuoteTaskInput,
  deps: ToolDeps = liveToolDeps,
): Promise<QuotedPlan & { goal: string; note?: string }> {
  const plan = await buildPlan(input.goal, { maxUsdPerStep: input.maxUsdPerStep }, deps.quote)
  return {
    goal: input.goal,
    ...plan,
    ...(plan.steps.length === 0
      ? {
          note: 'no quotable seller was found for any part of this goal — there is nothing to submit, and nothing was invented to fill the gap',
        }
      : {}),
  }
}

// --------------------------------------------------------------- submit_plan

export interface SubmitPlanInput {
  goal: string
  approach: string
  steps: StepInput[]
  ceilingUsd: number
  tolerancePct?: number
  expiresInMin?: number
  /** Pass `quote_task`'s selfCheck straight through; the human is shown these fixes. */
  selfCheck?: { turns: number; fixes: string[] }
}

/** Submit the priced plan and get back the URL a human approves. No money moves here. */
export async function submitPlan(input: SubmitPlanInput, deps: ToolDeps = liveToolDeps) {
  const plan: PlanInput = {
    goal: input.goal,
    approach: input.approach,
    steps: input.steps,
    ceilingUsd: input.ceilingUsd,
    tolerancePct: input.tolerancePct ?? DEFAULT_TOLERANCE_PCT,
    expiresInMin: input.expiresInMin ?? DEFAULT_EXPIRES_IN_MIN,
    selfCheck: input.selfCheck ?? { turns: 0, fixes: [] },
  }

  // Validate against the same schema the API uses, so a bad plan fails here with a
  // readable message instead of arriving as a 400 the agent has to guess at.
  const parsed = planInputSchema.safeParse(plan)
  if (!parsed.success) {
    throw new Error(
      `plan rejected before submission: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    )
  }

  const result = await postPlan(plan, deps.config(), deps.fetch)
  approvalUrls.set(result.planId, result.approvalUrl)
  return {
    ...result,
    totalUsd: totalUsd(plan.steps),
    ceilingUsd: plan.ceilingUsd,
    expiresInMin: plan.expiresInMin,
    handoff: 'send approvalUrl to the human — approval renders out-of-band from the agent, and approving is what funds the envelope',
  }
}

// ------------------------------------------------------------ await_approval

export interface AwaitApprovalInput {
  planId: string
  timeoutSec?: number
}

/**
 * Block until the human decides, or until the timeout. Polls; never waits forever —
 * an unattended agent that hangs on a human is an agent nobody can debug.
 */
export async function awaitApproval(input: AwaitApprovalInput, deps: ToolDeps = liveToolDeps) {
  const cfg = deps.config()
  const timeoutSec = input.timeoutSec ?? 600
  const deadline = deps.now().getTime() + timeoutSec * 1000

  for (;;) {
    const plan = await getPlan(input.planId, cfg, deps.fetch)
    if (plan.status !== 'pending_approval') {
      return {
        status: plan.status,
        decision: plan.decision,
        timedOut: false,
        approvalUrl: approvalUrls.get(input.planId),
        totalUsd: plan.totalUsd,
        ceilingUsd: plan.ceilingUsd,
      }
    }
    if (deps.now().getTime() + POLL_INTERVAL_MS > deadline) {
      return {
        status: plan.status,
        decision: null,
        timedOut: true,
        waitedSec: timeoutSec,
        approvalUrl: approvalUrls.get(input.planId),
        note: 'still pending — the plan is not rejected, the human just has not looked yet',
      }
    }
    await deps.sleep(POLL_INTERVAL_MS)
  }
}

// -------------------------------------------------------------- get_envelope

/**
 * The envelope row, once T7 mints one. Until then the plan carries no envelope and we
 * say so — a plan with no funded account has no ceiling to report.
 */
export async function getEnvelope(input: { planId: string }, deps: ToolDeps = liveToolDeps) {
  const plan = await getPlan(input.planId, deps.config(), deps.fetch)
  if (!plan.envelope) {
    return { ...notImplemented('get_envelope', 'T7 (envelope mint)'), planStatus: plan.status }
  }
  return { status: 'ok' as const, planStatus: plan.status, envelope: plan.envelope }
}

// -------------------------------------------------------------- pay_and_call

export interface PayAndCallInput {
  planId: string
  stepIdx: number
  params?: Record<string, string | number | boolean>
}

/** The gated payment path. Implemented in T9 — `POST /api/mcp/steps/pay` does not exist yet. */
export async function payAndCall(_input: PayAndCallInput, _deps: ToolDeps = liveToolDeps) {
  return notImplemented('pay_and_call', 'T9 (gated payment path)')
}

// ------------------------------------------------------------- report_drift

export interface ReportDriftInput {
  planId: string
  stepIdx: number
  liveAskUsd: number
}

/**
 * Price the drift for the human: what the gate says, what each exit costs, and where
 * to decide. The numbers come from `packages/core` — the same math the server gate
 * runs — so the agent cannot show the human a friendlier version of the block.
 */
export async function reportDrift(
  input: ReportDriftInput,
  deps: ToolDeps = liveToolDeps,
): Promise<{
  diffUrl: string
  gate: GateResult
  exits: ReturnType<typeof driftExits>
  recorded: false
  note: string
}> {
  const plan: PlanView = await getPlan(input.planId, deps.config(), deps.fetch)
  const step = plan.steps.find((s) => s.idx === input.stepIdx)
  if (!step) throw new Error(`plan ${input.planId} has no step ${input.stepIdx}`)

  const fundedUsd = Number(
    (plan.envelope as { funded_usd?: number } | null)?.funded_usd ?? plan.ceilingUsd,
  )
  const view = {
    ceilingUsd: plan.ceilingUsd,
    fundedUsd,
    tolerancePct: plan.tolerancePct,
    steps: plan.steps.map((s) => ({
      quoteUsd: s.quoteUsd,
      status: s.status,
      paidUsd: s.paidUsd ?? undefined,
    })),
  }
  const remaining = fundedUsd - view.steps.reduce((sum, s) => sum + (s.paidUsd ?? 0), 0)

  const approvalUrl = approvalUrls.get(input.planId)
  const diffUrl = approvalUrl
    ? `${approvalUrl}&drift=${input.stepIdx}`
    : `${deps.config().baseUrl}/p/${input.planId}`

  return {
    diffUrl,
    gate: gate(
      step,
      input.liveAskUsd,
      remaining,
      plan.tolerancePct,
      deps.now(),
      new Date(plan.expiresAt),
    ),
    exits: driftExits(view, input.stepIdx, input.liveAskUsd),
    recorded: false,
    note: approvalUrl
      ? 'the block itself is recorded server-side by pay_and_call (T9); this is the diff to show the human'
      : 'this process did not submit the plan, so the link carries no approval key — send the human their original approval link',
  }
}

// ---------------------------------------------------------------- close_plan

/** Sweep the remainder back and settle the plan. Implemented in T11. */
export async function closePlan(_input: { planId: string }, _deps: ToolDeps = liveToolDeps) {
  return notImplemented('close_plan', 'T11 (receipts + sweep)')
}
