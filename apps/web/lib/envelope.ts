import 'server-only'
import { createEnvelope, hcsLog } from '@planbound/chains/hedera'
import { db } from './db'

/**
 * Approval is funding. The moment a human approves, the envelope exists on Hedera with
 * exactly the approved ceiling in it — that is what makes the cap real rather than a
 * promise held in our database.
 *
 * Deliberately tolerant of failure: a plan that is approved but whose envelope did not
 * mint is recorded honestly (no envelope row) rather than rolled back into a state the
 * human did not choose. The console shows the gap; nothing pretends money moved.
 */
export async function mintEnvelopeForPlan(planId: string): Promise<{ minted: boolean; reason?: string }> {
  const supabase = db()

  const { data: plan } = await supabase
    .from('plans')
    .select('id, agent_id, ceiling_usd, expires_at, goal')
    .eq('id', planId)
    .maybeSingle()
  if (!plan) return { minted: false, reason: 'plan not found' }

  // Idempotent: a retried approval must not mint a second envelope.
  const { data: existing } = await supabase
    .from('envelopes')
    .select('plan_id')
    .eq('plan_id', planId)
    .maybeSingle()
  if (existing) return { minted: true }

  const { data: agent } = await supabase
    .from('agents')
    .select('hedera_public_key')
    .eq('id', plan.agent_id)
    .maybeSingle()
  if (!agent?.hedera_public_key) {
    return { minted: false, reason: 'agent has no registered Hedera public key (run pnpm register:agent)' }
  }

  try {
    const envelope = await createEnvelope({
      agentPublicKey: agent.hedera_public_key,
      ceilingUsd: Number(plan.ceiling_usd),
      expiresAt: new Date(plan.expires_at),
    })

    await supabase.from('envelopes').insert({
      plan_id: planId,
      hedera_account: envelope.accountId,
      hedera_schedule_id: envelope.scheduleId,
      hcs_topic: process.env.HCS_TOPIC_ID ?? null,
      funded_usd: envelope.fundedUsd,
    })

    // The audit trail records what was approved and what was funded, in that order.
    await hcsLog('plan', { planId, goal: plan.goal, ceilingUsd: Number(plan.ceiling_usd) })
    await hcsLog('approval', {
      planId,
      envelope: envelope.accountId,
      fundedUsd: envelope.fundedUsd,
      scheduleId: envelope.scheduleId,
    })

    return { minted: true }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[envelope] mint failed for ${planId}:`, reason)
    return { minted: false, reason }
  }
}
