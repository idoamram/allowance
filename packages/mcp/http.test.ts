/**
 * The HTTP wire speaks the same MCP as the stdio wire.
 *
 * The point of these cases is parity and protocol shape, not tool behaviour — the tools
 * themselves are already covered by `tools.test.ts`, and they are the same functions.
 */
import { describe, expect, it, vi } from 'vitest'
import { dispatch, LATEST_PROTOCOL_VERSION, TOOLS, toolList } from './http'
import type { ToolDeps } from './tools'

/** Deps that would fail loudly if a case reached the network. */
const deps = (): ToolDeps => ({
  config: () => ({ baseUrl: 'https://planbound.test', token: 'delegated-not-passed-through' }),
  fetch: vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
  quote: { discover: vi.fn(), quoteSteps: vi.fn() } as unknown as ToolDeps['quote'],
  now: () => new Date('2026-07-26T00:00:00Z'),
  sleep: async () => {},
})

const call = (method: string, params?: Record<string, unknown>, id: number | string | null = 1) =>
  dispatch({ jsonrpc: '2.0', id, method, params }, deps())

describe('handshake', () => {
  it('echoes a protocol version it supports', async () => {
    const res = await call('initialize', { protocolVersion: '2025-03-26' })
    expect((res!.result as { protocolVersion: string }).protocolVersion).toBe('2025-03-26')
  })

  it('offers the newest version when asked for one it does not know', async () => {
    const res = await call('initialize', { protocolVersion: '1999-01-01' })
    expect((res!.result as { protocolVersion: string }).protocolVersion).toBe(
      LATEST_PROTOCOL_VERSION,
    )
  })

  it('declares only the tools capability', async () => {
    const res = await call('initialize', {})
    expect((res!.result as { capabilities: Record<string, unknown> }).capabilities).toEqual({
      tools: { listChanged: false },
    })
  })

  it('answers ping', async () => {
    expect((await call('ping'))!.result).toEqual({})
  })
})

describe('tools', () => {
  it('serves the same seven tools the stdio server registers', async () => {
    const res = await call('tools/list')
    const names = (res!.result as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(names).toEqual([
      'quote_task',
      'submit_plan',
      'await_approval',
      'get_envelope',
      'pay_and_call',
      'report_drift',
      'close_plan',
    ])
  })

  it('publishes a JSON Schema object per tool', () => {
    for (const tool of toolList()) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' })
      expect(tool.description.length).toBeGreaterThan(40)
    }
    expect(TOOLS).toHaveLength(7)
  })

  it('rejects arguments that do not match the schema', async () => {
    const res = await call('tools/call', { name: 'submit_plan', arguments: { goal: 42 } })
    expect(res!.error?.code).toBe(-32602)
    expect(res!.error?.message).toContain('invalid arguments for submit_plan')
  })

  it('rejects an unknown tool by name', async () => {
    const res = await call('tools/call', { name: 'drain_wallet', arguments: {} })
    expect(res!.error?.code).toBe(-32602)
  })

  it('returns a tool failure as an isError result, not a protocol error', async () => {
    // close_plan is honest about not existing yet, so use a tool that throws: submit_plan
    // with a ceiling below the step total fails core validation inside the tool.
    const res = await call('tools/call', {
      name: 'submit_plan',
      arguments: {
        goal: 'vet three wallets',
        approach: 'one risk check each',
        ceilingUsd: 0.01,
        steps: [
          {
            serviceUrl: 'https://seller.test/risk',
            serviceName: 'seller',
            quoteUsd: 5,
            source: 'live-402',
            buys: 'a risk score',
            why: 'the cheapest live quote for this answer',
            rail: 'base',
          },
        ],
      },
    })
    expect(res!.error).toBeUndefined()
    expect((res!.result as { isError?: boolean }).isError).toBe(true)
  })

  it('returns a tool result as JSON text, the way a model reads it', async () => {
    const res = await call('tools/call', { name: 'close_plan', arguments: { planId: 'pl_x' } })
    const result = res!.result as { content: { type: string; text: string }[] }
    expect(result.content[0]!.type).toBe('text')
    expect(JSON.parse(result.content[0]!.text).planId).toBe('pl_x')
  })

  it('calls the control plane with the credential the transport handed it, not the caller\'s token', async () => {
    const d = deps()
    await dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'close_plan', arguments: { planId: 'pl_x' } } },
      d,
    )
    const [, init] = (d.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer delegated-not-passed-through',
    )
  })
})

describe('JSON-RPC framing', () => {
  it('answers nothing to a notification', async () => {
    expect(await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps())).toBeNull()
  })

  it('reports an unknown method as -32601', async () => {
    const res = await call('resources/list')
    expect(res!.error?.code).toBe(-32601)
  })

  it('refuses anything that is not JSON-RPC 2.0', async () => {
    const res = await dispatch(
      { jsonrpc: '1.0', id: 1, method: 'initialize' } as never,
      deps(),
    )
    expect(res!.error?.code).toBe(-32600)
  })
})
