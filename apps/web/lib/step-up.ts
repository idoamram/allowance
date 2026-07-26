import 'server-only'
import { db } from './db'
import { getBinding, verificationRequired, type HumanBinding } from './human-binding'
import { DEFAULT_STEP_UP_USD } from './verify'

/**
 * Does approving this plan need a human proof? Asked in one place, by everyone who asks.
 *
 * Three surfaces need this answer and they must agree, because a human meets all three in one
 * click: the approval page decides whether to render the verify block, `startStepUp` decides
 * whether to mint a challenge, and the decision gate decides whether to accept the approval.
 *
 * They did not agree. The rule was written out three times as the feature grew, and each copy
 * learned about the owner's enrolled policy at a different moment — so an owner on `always`
 * met a page that showed the block, a challenge endpoint that refused to start one saying the
 * plan "does not require step-up verification", and a gate that refused the approval for
 * lacking the proof the other two had just argued about. Every component was internally
 * consistent and the product was unusable.
 *
 * One function, one answer. The binding comes back with it because the caller that enforces
 * the gate needs it immediately afterwards to check *which* human proved.
 */
export interface StepUpDecision {
  /** True when a proof is required before this plan may be approved. */
  required: boolean
  /** The owner's binding, or null when the agent has no owner (a pre-accounts plan). */
  binding: HumanBinding | null
  /** The threshold this deployment runs, so callers can name it in copy. */
  lineUsd: number
}

/** The same ceiling the World verifier uses, read here so policy and gate agree. */
export const stepUpLineUsd = (): number => Number(process.env.STEP_UP_USD ?? DEFAULT_STEP_UP_USD)

/** The account that owns the agent whose plan this is — whose human, if any, is bound. */
export async function ownerOfAgent(agentId: string): Promise<string | null> {
  const { data } = await db().from('agents').select('owner_id').eq('id', agentId).maybeSingle()
  return (data as { owner_id: string | null } | null)?.owner_id ?? null
}

export async function stepUpDecision(
  agentId: string,
  ceilingUsd: number,
): Promise<StepUpDecision> {
  const lineUsd = stepUpLineUsd()
  const owner = await ownerOfAgent(agentId)
  const binding = owner ? await getBinding(owner) : null

  // No owner means no enrolled policy to consult, and nothing to bind against. Those plans
  // behave exactly as they did before accounts existed.
  const required = binding !== null && verificationRequired(binding.policy, ceilingUsd, lineUsd)

  return { required, binding, lineUsd }
}
