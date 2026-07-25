import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pluginRoot = resolve(repoRoot, 'plugin')

/** The launch command the plugin actually ships, with the plugin-root variable resolved. */
function pluginLaunch(): { command: string; args: string[] } {
  const config = JSON.parse(readFileSync(resolve(pluginRoot, '.mcp.json'), 'utf8')) as {
    mcpServers: Record<string, { command: string; args: string[] }>
  }
  const server = config.mcpServers.planbound
  return {
    command: server.command,
    args: server.args.map((a) => a.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot)),
  }
}

/**
 * Spawns the real server the way the plugin does. Unit tests cannot catch a bad tool
 * registration or a launch command that prints to stdout — both only fail when a client
 * actually connects, which in production means "silently broken in someone's terminal".
 */
describe('stdio server', () => {
  it('starts and advertises exactly the seven contracted tools', async () => {
    const client = new Client({ name: 'test', version: '0' })
    const transport = new StdioClientTransport({
      ...pluginLaunch(),
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
