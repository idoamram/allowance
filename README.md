# PlanBound

**Your agent asks for a plan, not a payment.**

An AI agent that spends today either gets a funded key (no budget, no scope, no kill switch)
or drowns its human in per-transaction popups that get rubber-stamped — 93% of permission
prompts are approved. Neither is consent.

PlanBound makes the agent **shop the task first**: discover real x402 sellers, collect live
402 quotes, and present one priced, reasoned plan — a one-line *why* per step. A single
approval **funds a single-use envelope** with exactly the approved ceiling. The agent runs
unattended inside it and cannot exceed it, because the money isn't there to exceed. When
reality drifts from the plan, the agent hits a wall and the human gets a diff with the sunk
cost on the table — not a context-free popup.

> **The one-sentence difference:** others give the agent a funded wallet and enforce the
> limit inside their own service. We give the agent zero funds and let consensus enforce
> the cap.

## The demo

**Flow A — the whole loop on Hedera testnet, no real money.** The agent quotes two services,
submits a plan, a human approves on their phone, and an envelope account is minted holding
exactly the ceiling. Its key is `1-of-[ 2-of-2(agent, policy), treasury ]`. The agent then
buys from the seller **paying out of that same account** — the thing that enforces the cap
and the thing that pays are one account, on one chain.

A real run, end to end: funded **$0.05** → two steps paid **$0.035** from the envelope →
close swept **$0.0115** back. Quoted equals paid; the remainder returned.

**The drift moment.** A step quoted at $0.01 met a real seller asking **$0.05**. The gate
blocked it *even though the envelope held enough to pay*, because the plan the human
approved was not the plan the agent found. The human got the diff: what already settled,
what changed and by how much, and three priced exits — approve at the new price, re-plan the
step, or abort and take the remainder back.

## Where each integration lives

Exact lines, so nobody has to grep.

### Hedera — envelope, dual control, HSS, HCS

| What | Where |
|---|---|
| Envelope account, nested threshold key `1-of-[2-of-2(agent,policy), treasury]` | [`packages/chains/hedera.ts:174`](packages/chains/hedera.ts#L174) |
| Keeperless refund — `ScheduleCreateTransaction` + `waitForExpiry` | [`packages/chains/hedera.ts:203`](packages/chains/hedera.ts#L203) |
| **Envelope as x402 payer** — agent + policy co-sign; the facilitator's fee signature completes the threshold | [`packages/chains/hedera.ts:300`](packages/chains/hedera.ts#L300) |
| Sweep the remainder home | [`packages/chains/hedera.ts:230`](packages/chains/hedera.ts#L230) |
| HCS audit trail — `TopicMessageSubmitTransaction` | [`packages/chains/hedera.ts:275`](packages/chains/hedera.ts#L275) |
| Reference seller on the Hedera rail (**ours, and labelled**) | [`apps/web/app/api/reference-seller/[service]/route.ts`](apps/web/app/api/reference-seller/%5Bservice%5D/route.ts) |

### x402 — discovery, quoting, gated payment

| What | Where |
|---|---|
| Bazaar discovery (keyless), network-filtered | [`packages/chains/discovery.ts:63`](packages/chains/discovery.ts#L63) |
| Live quoting → `live-402` vs `estimate` | [`packages/chains/discovery.ts:110`](packages/chains/discovery.ts#L110) |
| 402 parsing — header first, body fallback, rail selection | [`packages/chains/x402pay.ts:70`](packages/chains/x402pay.ts#L70) |
| Rail preference order | [`packages/chains/x402pay.ts:38`](packages/chains/x402pay.ts#L38) |
| Payment, scheme selected by rail (`ExactEvmScheme` / `ExactHederaScheme`) | [`packages/chains/x402pay.ts:176`](packages/chains/x402pay.ts#L176) |
| **The gate, in the only path money leaves by** | [`apps/web/app/api/mcp/steps/pay/route.ts`](apps/web/app/api/mcp/steps/pay/route.ts) |

### The policy math

| What | Where |
|---|---|
| `gate()` — blocks on drift, over-remaining, or expiry | [`packages/core/money.ts:43`](packages/core/money.ts#L43) |
| `driftExits()` — the three priced ways out | [`packages/core/money.ts:69`](packages/core/money.ts#L69) |

### World — identity as step-up

| What | Where |
|---|---|
| `HumanVerifier` seam; `none` is the shipping default | [`apps/web/lib/verify/index.ts:31`](apps/web/lib/verify/index.ts#L31) |
| World ID 4.0 — RP signature minted server-side | [`apps/web/lib/verify/world.ts:143`](apps/web/lib/verify/world.ts#L143) |
| Proof forwarded to `/api/v4/verify/{rp_id}` | [`apps/web/lib/verify/world.ts:175`](apps/web/lib/verify/world.ts#L175) |
| Step-up enforced server-side, not just in the UI | [`apps/web/app/p/[id]/actions.ts:91`](apps/web/app/p/%5Bid%5D/actions.ts#L91) |

### The Graph — verifying us against the chain

| What | Where |
|---|---|
| Subgraph manifest (Base USDC) | [`subgraph/subgraph.yaml`](subgraph/subgraph.yaml) |
| Claimed-vs-settled reconciliation | [`apps/web/lib/reconcile.ts:75`](apps/web/lib/reconcile.ts#L75) |
| Seller trust from settlement history | [`apps/web/app/api/mcp/seller-trust/route.ts`](apps/web/app/api/mcp/seller-trust/route.ts) |
| **Substreams indexing skill** (generic, installable) | [`plugin/skills/index-settlements/`](plugin/skills/index-settlements/) |

### The agent surface

| What | Where |
|---|---|
| MCP server, seven tools | [`packages/mcp/server.ts:76`](packages/mcp/server.ts#L76) |
| Plan composition + bounded self-check | [`packages/mcp/plan.ts:211`](packages/mcp/plan.ts#L211) |
| Headless driver (dogfood agent) | [`scripts/driver.ts`](scripts/driver.ts) |
| Claude Code plugin | [`plugin/.mcp.json`](plugin/.mcp.json) |

## Run it yourself

Everything resolves from environment variables, so you bring your own resources — nothing of
ours is hardcoded anywhere.

```bash
pnpm install
cp .env.example .env.local          # every variable, with where to get it
pnpm keygen HEDERA_POLICY_KEY AGENT_EVM_KEY   # writes to .env.local, prints only public values
# add HEDERA_OPERATOR_ID / _KEY from portal.hedera.com (testnet), and your Supabase keys
pnpm hcs:topic                      # creates the audit topic, records its id
pnpm seed:agent && pnpm register:agent
pnpm dev
pnpm driver "vet 3 counterparty wallets before I pay them"
```

Hedera testnet is free, so the whole loop runs on faucet funds. Mainnet purchases stay
impossible until you set `MAINNET_PAY=true` yourself.

## Honesty box

- **The reference seller on the Hedera rail is ours, and the code says so.** There is no
  Hedera x402 seller market and no directory that could find one (checked 2026-07-25), so we
  became the first working seller on it rather than pretending a market exists. Every *other*
  seller is a stranger discovered through the Bazaar.
- **Per-service policy logic is off-chain.** The 2-of-2 key makes bypassing it impossible,
  not on-chain.
- **The keeperless refund covers the abandoned-plan case only** — scheduled transactions
  carry fixed amounts, so a partly-spent envelope is swept by the control plane or reclaimed
  by the treasury key.
- **Demo drift is our own conservative estimate meeting a real seller's real ask.** The ask
  is not staged; the estimate being low is what makes the collision reproducible.
- **The subgraph claims "since deployment"**, never "this month" — it starts from a recent
  block so it syncs in minutes.
- **World step-up has not completed a real proof end to end** at the time of writing; what is
  verified is documented in [`docs/feedback/world.md`](docs/feedback/world.md).
- **The console has no auth** and lists every plan. Fine for demo data; it says so on itself.

## Team & AI use

Ido (backend, chain, agents) · Yuval (frontend, UX, docs). Built with AI agents under
documented supervision — see [`docs/AI-USAGE.md`](docs/AI-USAGE.md), the committed spec trail
in [`plans/`](plans/), and the session prompts in
[`plans/implementation/prompts/`](plans/implementation/prompts/).

MIT licensed.
