# `@planbound/mcp` — the agent's surface

A local stdio MCP server. The Claude Code plugin (`plugin/.mcp.json`) launches it; any
MCP-capable framework can too. It is deliberately **local**: the agent's key stays on the
dev's machine and this process calls the control plane for approval state and co-signing.
A hosted remote MCP would be a custodial mode, and this is not that.

## The seven tools

| Tool | Shape | Status |
|---|---|---|
| `quote_task` | `{goal, maxUsdPerStep?}` → `{steps, approach, selfCheck, gaps, totalUsd, suggestedCeilingUsd}` | live |
| `submit_plan` | `{goal, approach, steps, ceilingUsd, tolerancePct?, expiresInMin?, selfCheck?}` → `{planId, approvalUrl}` | live |
| `await_approval` | `{planId, timeoutSec?}` → `{status, decision, timedOut}` | live |
| `report_drift` | `{planId, stepIdx, liveAskUsd}` → `{diffUrl, gate, exits}` | live (the block itself is recorded by `pay_and_call`) |
| `get_envelope` | `{planId}` → envelope row | `not_implemented` until T7 mints envelopes |
| `pay_and_call` | `{planId, stepIdx, params?}` → `{data, paidUsd}` \| `{gate}` | `not_implemented` until T9 |
| `close_plan` | `{planId}` → `{sweptUsd}` | `not_implemented` until T11 |

`not_implemented` is a deliberate answer, not a stub: those three need money that does
not exist until the envelope does. An agent that gets `not_implemented` stops; an agent
that gets a fake receipt lies to a human.

## Files

- `plan.ts` — `quote_task`'s brain: goal → categories → discovery → live quotes →
  bounded self-check → one-line approach. The honesty rules live here.
- `api.ts` — the control-plane client. Every call is bounded by a timeout and every
  failure names what went wrong; a hanging tool is worse than a failing one.
- `tools.ts` — the seven tools as plain functions, with the world injected as `deps`.
- `server.ts` — the stdio wire. Forces all diagnostics to stderr: stdout is JSON-RPC.

## Running it

```bash
pnpm --filter mcp start          # what plugin/.mcp.json runs
pnpm driver "vet 3 counterparty wallets before I pay them"   # same flow, headless
pnpm driver --dry "…"            # quote only; submits nothing, spends nothing
```

Env (from `.env.local`, loaded by the server itself): `PLANBOUND_API_URL`,
`PLANBOUND_AGENT_TOKEN`. `quote_task` needs neither — discovery and probing are free
reads, so you can quote before the control plane exists.

## Tests

`pnpm test` — 33 unit tests run offline (discovery and HTTP are injected), plus one
smoke test that spawns the server using the plugin's own launch command and asserts the
seven tools come back over real stdio.
