import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Spawns the real server over real stdio. Unit tests cannot catch a bad tool
 * registration — a malformed schema only fails when a client actually connects, which
 * in production means "the plugin is silently broken in someone's terminal".
 */
describe('stdio server', () => {
  it('starts and advertises exactly the seven contracted tools', async () => {
    const client = new Client({ name: 'test', version: '0' })
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['tsx', resolve(here, 'server.ts')],
      // No control-plane config: the server must still start and list its tools.
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    })
    await client.connect(transport)
    try {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).sort()).toEqual([
        'await_approval',
        'close_plan',
        'get_envelope',
        'pay_and_call',
        'quote_task',
        'report_drift',
        'submit_plan',
      ])
      for (const tool of tools) expect(tool.description ?? '').not.toBe('')

      // A tool that needs the control plane must fail as a readable error, not a crash.
      const result = (await client.callTool({
        name: 'close_plan',
        arguments: { planId: 'pl_nope' },
      })) as { content: { text: string }[] }
      expect(result.content[0].text).toMatch(/not_implemented/)
    } finally {
      await client.close()
    }
  }, 60_000)
})
