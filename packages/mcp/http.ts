/**
 * The same seven tools, spoken over JSON-RPC instead of stdio.
 *
 * `server.ts` is the stdio wire and does not change: it is the demo path, and the agent's
 * key signs where it lives (latest.md §5). This module is the *second* wire — a
 * transport-agnostic dispatcher the Next.js route in `apps/web/app/api/mcp/http` wraps in
 * Streamable HTTP and OAuth. Both wires call the identical functions in `tools.ts`; the
 * tool implementations are not forked, and every dependency that touches the world still
 * arrives through the existing `ToolDeps` seam — which is exactly how the HTTP server hands
 * each request its own, per-caller control-plane credential.
 *
 * Written against the MCP schema by hand rather than through the SDK's `McpServer`, because
 * the SDK's HTTP transport wants Node's `IncomingMessage`/`ServerResponse` and a Next route
 * handler has Web `Request`/`Response`. The dispatched surface is small enough — initialize,
 * ping, tools/list, tools/call — that adapting streams would have been the larger risk.
 */
import { z } from 'zod'
import {
  awaitApproval,
  closePlan,
  getEnvelope,
  payAndCall,
  quoteTask,
  reportDrift,
  submitPlan,
  type ToolDeps,
} from './tools'

export const SERVER_INFO = { name: 'planbound', version: '0.1.0' } as const

export const INSTRUCTIONS =
  'PlanBound turns a spending task into a priced plan a human approves once. Always ' +
  'quote_task before submit_plan, show the human the [live]/[est.] badge for every ' +
  'step, and never edit a quoted price by hand.'

/**
 * Versions this server speaks. The newest is offered when a client asks for something we
 * do not recognise — the spec's negotiation rule, and better than failing a handshake over
 * a version string.
 */
export const LATEST_PROTOCOL_VERSION = '2025-06-18'
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

// ------------------------------------------------------------------ JSON-RPC

export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const

export const rpcError = (id: JsonRpcId, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
})

const rpcOk = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })

// --------------------------------------------------------------------- tools

/**
 * JSON Schema is written out rather than derived from the zod shapes: `tools/list` is a
 * wire contract a model reads, and the descriptions here are the same ones the stdio server
 * publishes. Zod still validates every call, so the two never disagree about what is legal —
 * only about who states it.
 */
export interface McpTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  args: z.ZodTypeAny
  run: (args: never, deps: ToolDeps) => Promise<unknown>
}

const stepInput = z.object({
  serviceUrl: z.string().url(),
  serviceName: z.string(),
  quoteUsd: z.number(),
  source: z.enum(['live-402', 'estimate']),
  buys: z.string(),
  why: z.string(),
  rail: z.enum(['hedera', 'worldchain', 'base']),
})

const stepInputJson = {
  type: 'object',
  properties: {
    serviceUrl: { type: 'string', format: 'uri' },
    serviceName: { type: 'string' },
    quoteUsd: { type: 'number' },
    source: { type: 'string', enum: ['live-402', 'estimate'] },
    buys: { type: 'string' },
    why: { type: 'string' },
    rail: { type: 'string', enum: ['hedera', 'worldchain', 'base'] },
  },
  required: ['serviceUrl', 'serviceName', 'quoteUsd', 'source', 'buys', 'why', 'rail'],
  additionalProperties: false,
} as const

export const TOOLS: McpTool[] = [
  {
    name: 'quote_task',
    title: 'Quote a task',
    description:
      'Shop a spending goal: search the x402 Bazaar for real sellers, probe them for real ' +
      'HTTP 402 prices, self-check the result (≤3 bounded passes, fixes logged), and return ' +
      'priced steps plus a one-line approach. Every step is labeled live-402 or estimate — ' +
      'render those as [live] / [est.] and never smooth over the difference. Costs nothing: ' +
      'discovery and probing are free reads.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: "the spending task in the human's own words" },
        maxUsdPerStep: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'policy applied at discovery: candidates above this price never enter the plan',
        },
      },
      required: ['goal'],
      additionalProperties: false,
    },
    args: z.object({ goal: z.string(), maxUsdPerStep: z.number().positive().optional() }),
    run: (args: { goal: string; maxUsdPerStep?: number }, deps) => quoteTask(args, deps),
  },
  {
    name: 'submit_plan',
    title: 'Submit a plan for approval',
    description:
      'Send the priced plan to the control plane and get back the URL a human approves. ' +
      'Submission is free; the approval itself is what funds the envelope. Pass quote_task ' +
      "output through unchanged — the steps' prices are quotes, not suggestions.",
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        approach: { type: 'string', description: "the plan's logic in one sentence" },
        steps: { type: 'array', items: stepInputJson, minItems: 1 },
        ceilingUsd: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'the approved ceiling; must be ≥ the step total',
        },
        tolerancePct: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'per-step drift absorbed silently before the gate blocks (default 20)',
        },
        expiresInMin: { type: 'integer', exclusiveMinimum: 0, description: 'default 60' },
        selfCheck: {
          type: 'object',
          properties: {
            turns: { type: 'integer' },
            fixes: { type: 'array', items: { type: 'string' } },
          },
          required: ['turns', 'fixes'],
          additionalProperties: false,
          description: 'pass quote_task.selfCheck through — the human is shown these fixes',
        },
      },
      required: ['goal', 'approach', 'steps', 'ceilingUsd'],
      additionalProperties: false,
    },
    args: z.object({
      goal: z.string(),
      approach: z.string(),
      steps: z.array(stepInput).min(1),
      ceilingUsd: z.number().positive(),
      tolerancePct: z.number().min(0).max(100).optional(),
      expiresInMin: z.number().int().positive().optional(),
      selfCheck: z.object({ turns: z.number().int(), fixes: z.array(z.string()) }).optional(),
    }),
    run: (args: Parameters<typeof submitPlan>[0], deps) => submitPlan(args, deps),
  },
  {
    name: 'await_approval',
    title: 'Wait for the human decision',
    description:
      'Poll until the human approves, rejects or edits the plan, or until timeoutSec elapses. ' +
      'A timeout is not a rejection — it means nobody has looked yet.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string' },
        timeoutSec: { type: 'integer', exclusiveMinimum: 0, description: 'default 600' },
      },
      required: ['planId'],
      additionalProperties: false,
    },
    args: z.object({ planId: z.string(), timeoutSec: z.number().int().positive().optional() }),
    run: (args: Parameters<typeof awaitApproval>[0], deps) => awaitApproval(args, deps),
  },
  {
    name: 'get_envelope',
    title: 'Read the plan envelope',
    description:
      'The funded single-use account behind an approved plan: ceiling, what is left, and its ' +
      'on-chain identifiers — the Hedera account, its scheduled sweep, and the HCS topic the ' +
      'receipts are written to.',
    inputSchema: {
      type: 'object',
      properties: { planId: { type: 'string' } },
      required: ['planId'],
      additionalProperties: false,
    },
    args: z.object({ planId: z.string() }),
    run: (args: { planId: string }, deps) => getEnvelope(args, deps),
  },
  {
    name: 'pay_and_call',
    title: 'Pay a step and call the service',
    description:
      'Re-probe the seller for its live ask, run the policy gate against the approved quote ' +
      'and the remaining envelope, then pay from the envelope over x402 and return the ' +
      "seller's response. A step asking more than its approved tolerance comes back blocked " +
      'with the drift priced, not paid — call report_drift to put that decision to the human.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string' },
        stepIdx: { type: 'integer', minimum: 0 },
        params: {
          type: 'object',
          additionalProperties: { type: ['string', 'number', 'boolean'] },
        },
      },
      required: ['planId', 'stepIdx'],
      additionalProperties: false,
    },
    args: z.object({
      planId: z.string(),
      stepIdx: z.number().int().min(0),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    }),
    run: (args: Parameters<typeof payAndCall>[0], deps) => payAndCall(args, deps),
  },
  {
    name: 'report_drift',
    title: 'Price a drift and get the diff link',
    description:
      'When a seller asks more than the approved quote, this prices the three exits — finish ' +
      '(top up the shortfall), re-plan, or abort (sweep what is left) — using the same math the ' +
      'server gate runs, and returns the link where the human decides.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string' },
        stepIdx: { type: 'integer', minimum: 0 },
        liveAskUsd: {
          type: 'number',
          minimum: 0,
          description: "the seller's actual ask, from a fresh probe",
        },
      },
      required: ['planId', 'stepIdx', 'liveAskUsd'],
      additionalProperties: false,
    },
    args: z.object({
      planId: z.string(),
      stepIdx: z.number().int().min(0),
      liveAskUsd: z.number().nonnegative(),
    }),
    run: (args: Parameters<typeof reportDrift>[0], deps) => reportDrift(args, deps),
  },
  {
    name: 'close_plan',
    title: 'Close the plan and sweep',
    description:
      'Settle the plan: sweep the unspent remainder out of the envelope and back to the ' +
      'treasury, and record the close on the plan HCS topic. Safe to call when steps remain ' +
      'unpaid — the remainder simply comes back larger.',
    inputSchema: {
      type: 'object',
      properties: { planId: { type: 'string' } },
      required: ['planId'],
      additionalProperties: false,
    },
    args: z.object({ planId: z.string() }),
    run: (args: { planId: string }, deps) => closePlan(args, deps),
  },
]

const byName = new Map(TOOLS.map((t) => [t.name, t]))

/** `tools/list` payload — the schema field the wire wants, without the zod twin. */
export const toolList = () =>
  TOOLS.map(({ name, title, description, inputSchema }) => ({
    name,
    title,
    description,
    inputSchema,
  }))

// ---------------------------------------------------------------- dispatching

export const isNotification = (msg: JsonRpcRequest) => msg.id === undefined

/**
 * One JSON-RPC message in, one response out — or `null` for a notification, which by the
 * spec gets no reply at all.
 *
 * `deps` is per-request on purpose. The HTTP server builds a fresh `ToolDeps` carrying the
 * credential it minted for *this* caller's agent, so two operators hitting the same process
 * never share a control-plane identity.
 */
export async function dispatch(
  msg: JsonRpcRequest,
  deps: ToolDeps,
): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null

  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(id, RPC.invalidRequest, 'not a JSON-RPC 2.0 request')
  }

  // Notifications are acknowledged by the transport (202), never answered here.
  if (isNotification(msg)) {
    return null
  }

  switch (msg.method) {
    case 'initialize': {
      const asked = (msg.params?.protocolVersion as string | undefined) ?? LATEST_PROTOCOL_VERSION
      return rpcOk(id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(asked)
          ? asked
          : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      })
    }

    case 'ping':
      return rpcOk(id, {})

    case 'tools/list':
      return rpcOk(id, { tools: toolList() })

    case 'tools/call': {
      const name = msg.params?.name
      if (typeof name !== 'string') {
        return rpcError(id, RPC.invalidParams, 'tools/call requires a string `name`')
      }
      const tool = byName.get(name)
      if (!tool) return rpcError(id, RPC.invalidParams, `unknown tool: ${name}`)

      const parsed = tool.args.safeParse(msg.params?.arguments ?? {})
      if (!parsed.success) {
        return rpcError(
          id,
          RPC.invalidParams,
          `invalid arguments for ${name}: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
        )
      }

      try {
        const payload = await tool.run(parsed.data as never, deps)
        return rpcOk(id, {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        })
      } catch (error) {
        // A tool that fails is a tool result, not a protocol error: the model has to see
        // the message to decide what to do next.
        return rpcOk(id, {
          isError: true,
          content: [
            {
              type: 'text',
              text: `error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        })
      }
    }

    default:
      return rpcError(id, RPC.methodNotFound, `method not found: ${msg.method}`)
  }
}
