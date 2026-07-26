/**
 * The seven MCP tools, as plain functions. `server.ts` is only the wire.
 *
 * Split this way so the tools are unit-testable without a transport: every dependency
 * that touches the world — HTTP, discovery, the clock, sleeping — arrives in `deps`.
 *
 * All seven are wired to real routes. The one thing never faked is a receipt: a step that
 * did not settle stays pending, and a step the gate refused returns the refusal as data.
 * An agent that gets a fake receipt lies to a human, which is the failure this whole
 * surface exists to prevent.
 */
import { driftExits, gate, totalUsd, type GateResult, type PlanInput, type StepInput } from '@planbound/core'
import { planInputSchema } from '@planbound/core'
import { buildPlan, liveDeps, type QuoteDeps, type QuotedPlan } from './plan'
import {
  configFromEnv,
  getPlan,
  postClosePlan,
  postPlan,
  postStepPay,
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

/**
 * No envelope yet is a normal state, not a failure: a plan carries none until a human
 * approves it, and approval is the act that mints one. Reported as its own status so an
 * agent waits rather than retrying a purchase that has nothing to draw on.
 */
const noEnvelope = (planStatus: string) => ({
  status: 'no_envelope' as const,
  planStatus,
  reason:
    planStatus === 'pending_approval'
      ? 'nobody has approved this plan yet — approving is what funds the envelope'
      : `this plan is ${planStatus} and has no funded envelope`,
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
 * The envelope: the account holding exactly what the human approved, and the only funds
 * this plan can ever draw on. A plan with no funded account has no ceiling to report.
 */
export async function getEnvelope(input: { planId: string }, deps: ToolDeps = liveToolDeps) {
  const plan = await getPlan(input.planId, deps.config(), deps.fetch)
  if (!plan.envelope) return noEnvelope(plan.status)
  return { status: 'ok' as const, planStatus: plan.status, envelope: plan.envelope }
}

// -------------------------------------------------------------- pay_and_call

export interface PayAndCallInput {
  planId: string
  stepIdx: number
  params?: Record<string, string | number | boolean>
}

/**
 * The gated payment path — the only tool that moves money, and the only one that can be
 * refused.
 *
 * The gate re-probes the seller's live price and compares it against what the human
 * approved. A block is returned as data, not thrown: `blocked` carries the live ask, the
 * approved ceiling, what remains, and a link to the diff the human decides from. An agent
 * that treats that as an error learns nothing from it, and the whole product is the part
 * where the agent stops and asks.
 *
 * Nothing here re-checks the gate client-side. The server decides, because the server is
 * the side holding the envelope's keys.
 */
export async function payAndCall(input: PayAndCallInput, deps: ToolDeps = liveToolDeps) {
  const res = await postStepPay(input, deps.config(), deps.fetch)

  if (res.paid) {
    return {
      status: 'paid' as const,
      planId: input.planId,
      stepIdx: input.stepIdx,
      paidUsd: res.paidUsd,
      txRef: res.txRef,
      data: res.data,
    }
  }

  if ('gate' in res) {
    const approvalUrl = approvalUrls.get(input.planId)
    return {
      status: 'blocked' as const,
      planId: input.planId,
      stepIdx: input.stepIdx,
      reason: res.gate.reason ?? 'blocked',
      serviceName: res.serviceName,
      liveAskUsd: res.gate.liveAskUsd,
      approvedUsd: res.gate.quoteUsd,
      maxAllowedUsd: res.gate.maxAllowedUsd,
      remainingUsd: res.gate.remainingUsd,
      // Prefer the link that carries the approval key; the server's fallback has none and
      // would 404 for the human.
      diffUrl: approvalUrl ? `${approvalUrl}&drift=${input.stepIdx}` : res.diffUrl,
      handoff:
        'stop and send the human the diff — this step cannot be paid at the approved ceiling, and re-running this tool will be refused the same way until they decide',
    }
  }

  return { status: 'refused' as const, planId: input.planId, stepIdx: input.stepIdx, reason: res.error }
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

/**
 * Sweep the remainder home and settle the plan.
 *
 * This is what makes the ceiling an envelope rather than a budget: whatever the plan did
 * not spend goes back, and the account that could spend it stops existing as a spender.
 * Calling it is not optional politeness — an unswept envelope is funds sitting in an
 * account whose keys an agent holds.
 */
export async function closePlan(input: { planId: string }, deps: ToolDeps = liveToolDeps) {
  const result = await postClosePlan(input.planId, deps.config(), deps.fetch)
  // The route's own status wins — it is the side that swept, and reporting 'settled' over
  // a result that says otherwise would be exactly the fake receipt this file refuses.
  return { planId: input.planId, ...result }
}
