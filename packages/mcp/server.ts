#!/usr/bin/env node
/**
 * PlanBound MCP server — local stdio, launched by the Claude Code plugin.
 *
 * Local by design (latest.md §5, "Keys sign where they live"): the agent's key stays
 * on the dev's machine and this process calls the control plane for approval state and
 * co-signing. A hosted remote MCP would be a custodial mode and is not this.
 *
 * stdout is the JSON-RPC channel. Anything printed there corrupts the protocol, so
 * every diagnostic in this process — ours or a dependency's — is forced onto stderr.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { config as loadEnv } from 'dotenv'
import { z } from 'zod'
import {
  awaitApproval,
  closePlan,
  getEnvelope,
  payAndCall,
  quoteTask,
  reportDrift,
  submitPlan,
} from './tools'

console.log = console.error
console.info = console.error

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
// The plugin may launch us from anywhere; the agent's own config lives with the repo.
// Values are read, never echoed.
loadEnv({ path: resolve(repoRoot, '.env.local'), quiet: true } as Parameters<typeof loadEnv>[0])

const server = new McpServer(
  { name: 'planbound', version: '0.1.0' },
  {
    instructions:
      'PlanBound turns a spending task into a priced plan a human approves once. Always ' +
      'quote_task before submit_plan, show the human the [live]/[est.] badge for every ' +
      'step, and never edit a quoted price by hand.',
  },
)

/** Tool results are JSON text — the caller is a model, and JSON is what it reads best. */
const ok = (payload: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
})

const fail = (error: unknown) => ({
  isError: true,
  content: [
    { type: 'text' as const, text: `error: ${error instanceof Error ? error.message : String(error)}` },
  ],
})

const run = async (fn: () => Promise<unknown>) => {
  try {
    return ok(await fn())
  } catch (error) {
    return fail(error)
  }
}

const stepInputShape = z.object({
  serviceUrl: z.string().url(),
  serviceName: z.string(),
  quoteUsd: z.number(),
  source: z.enum(['live-402', 'estimate']),
  buys: z.string(),
  why: z.string(),
  rail: z.enum(['hedera', 'worldchain', 'base']),
})

server.registerTool(
  'quote_task',
  {
    title: 'Quote a task',
    description:
      'Shop a spending goal: search the x402 Bazaar for real sellers, probe them for real ' +
      'HTTP 402 prices, self-check the result (≤3 bounded passes, fixes logged), and return ' +
      'priced steps plus a one-line approach. Every step is labeled live-402 or estimate — ' +
      'render those as [live] / [est.] and never smooth over the difference. Costs nothing: ' +
      'discovery and probing are free reads.',
    inputSchema: {
      goal: z.string().describe("the spending task in the human's own words"),
      maxUsdPerStep: z
        .number()
        .positive()
        .optional()
        .describe('policy applied at discovery: candidates above this price never enter the plan'),
    },
  },
  async (args) => run(() => quoteTask(args)),
)

server.registerTool(
  'submit_plan',
  {
    title: 'Submit a plan for approval',
    description:
      'Send the priced plan to the control plane and get back the URL a human approves. ' +
      'Submission is free; the approval itself is what funds the envelope. Pass quote_task ' +
      "output through unchanged — the steps' prices are quotes, not suggestions.",
    inputSchema: {
      goal: z.string(),
      approach: z.string().describe("the plan's logic in one sentence"),
      steps: z.array(stepInputShape).min(1),
      ceilingUsd: z.number().positive().describe('the approved ceiling; must be ≥ the step total'),
      tolerancePct: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe('per-step drift absorbed silently before the gate blocks (default 20)'),
      expiresInMin: z.number().int().positive().optional().describe('default 60'),
      selfCheck: z
        .object({ turns: z.number().int(), fixes: z.array(z.string()) })
        .optional()
        .describe('pass quote_task.selfCheck through — the human is shown these fixes'),
    },
  },
  async (args) => run(() => submitPlan(args)),
)

server.registerTool(
  'await_approval',
  {
    title: 'Wait for the human decision',
    description:
      'Poll until the human approves, rejects or edits the plan, or until timeoutSec elapses. ' +
      'A timeout is not a rejection — it means nobody has looked yet.',
    inputSchema: {
      planId: z.string(),
      timeoutSec: z.number().int().positive().optional().describe('default 600'),
    },
  },
  async (args) => run(() => awaitApproval(args)),
)

server.registerTool(
  'get_envelope',
  {
    title: 'Read the plan envelope',
    description:
      'The funded single-use account behind an approved plan: ceiling, what is left, and its ' +
      'on-chain identifiers — the Hedera account, its scheduled sweep, and the HCS topic the ' +
      'receipts are written to.',
    inputSchema: { planId: z.string() },
  },
  async (args) => run(() => getEnvelope(args)),
)

server.registerTool(
  'pay_and_call',
  {
    title: 'Pay a step and call the service',
    description:
      'Re-probe the seller for its live ask, run the policy gate against the approved quote ' +
      'and the remaining envelope, then pay from the envelope over x402 and return the ' +
      "seller's response. A step asking more than its approved tolerance comes back blocked " +
      'with the drift priced, not paid — call report_drift to put that decision to the human.',
    inputSchema: {
      planId: z.string(),
      stepIdx: z.number().int().min(0),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    },
  },
  async (args) => run(() => payAndCall(args)),
)

server.registerTool(
  'report_drift',
  {
    title: 'Price a drift and get the diff link',
    description:
      'When a seller asks more than the approved quote, this prices the three exits — finish ' +
      '(top up the shortfall), re-plan, or abort (sweep what is left) — using the same math the ' +
      'server gate runs, and returns the link where the human decides.',
    inputSchema: {
      planId: z.string(),
      stepIdx: z.number().int().min(0),
      liveAskUsd: z.number().nonnegative().describe("the seller's actual ask, from a fresh probe"),
    },
  },
  async (args) => run(() => reportDrift(args)),
)

server.registerTool(
  'close_plan',
  {
    title: 'Close the plan and sweep',
    description:
      'Settle the plan: sweep the unspent remainder out of the envelope and back to the ' +
      'treasury, and record the close on the plan HCS topic. Safe to call when steps remain ' +
      'unpaid — the remainder simply comes back larger.',
    inputSchema: { planId: z.string() },
  },
  async (args) => run(() => closePlan(args)),
)

await server.connect(new StdioServerTransport())
console.error('[planbound-mcp] ready on stdio')
