/**
 * Zod mirrors of the contract types — the API's validation boundary.
 * A request that fails here never reaches the database or a payment path.
 */
import { z } from 'zod'

export const quoteSourceSchema = z.enum(['live-402', 'estimate'])
export const railSchema = z.enum(['hedera', 'worldchain', 'base'])
export const decisionOutcomeSchema = z.enum([
  'approved',
  'rejected',
  'edited',
  'drift_approved',
  'drift_replan',
  'drift_abort',
])
export const decisionTargetSchema = z.enum(['price', 'logic', 'scope', 'service'])

/** USD carried at USDC precision; non-negative and finite by construction. */
const usd = z.number().finite().nonnegative().max(1_000_000)

export const stepInputSchema = z.object({
  serviceUrl: z.string().url(),
  serviceName: z.string().min(1).max(120),
  quoteUsd: usd,
  source: quoteSourceSchema,
  buys: z.string().min(1).max(300),
  why: z.string().min(1).max(300),
  rail: railSchema,
})

export const planInputSchema = z
  .object({
    goal: z.string().min(1).max(500),
    approach: z.string().min(1).max(500),
    steps: z.array(stepInputSchema).min(1).max(12),
    ceilingUsd: usd,
    tolerancePct: z.number().finite().min(0).max(100),
    expiresInMin: z.number().int().positive().max(1440),
    selfCheck: z.object({
      turns: z.number().int().min(0).max(10),
      fixes: z.array(z.string().max(300)).max(20),
    }),
  })
  .refine(
    (p) => p.ceilingUsd >= Number(p.steps.reduce((s, x) => s + x.quoteUsd, 0).toFixed(6)),
    { message: 'ceilingUsd must be at least the sum of step quotes', path: ['ceilingUsd'] },
  )

export const decisionSchema = z
  .object({
    outcome: decisionOutcomeSchema,
    target: decisionTargetSchema.optional(),
    reason: z.string().max(1000).optional(),
    stepIdx: z.number().int().min(0).max(11).optional(),
  })
  .refine((d) => d.outcome !== 'rejected' || (d.target != null && (d.reason?.length ?? 0) > 0), {
    message: 'a rejection must carry a typed target and a reason — that is what the loop learns from',
    path: ['target'],
  })

export const payRequestSchema = z.object({
  planId: z.string().min(1).max(64),
  stepIdx: z.number().int().min(0).max(11),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
})

export type PlanInputParsed = z.infer<typeof planInputSchema>
export type DecisionParsed = z.infer<typeof decisionSchema>
export type PayRequestParsed = z.infer<typeof payRequestSchema>
