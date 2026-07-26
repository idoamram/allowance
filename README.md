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

The narration for the recorded walkthrough, beat by beat, is in
[`docs/demo-script.md`](docs/demo-script.md).

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
| Subgraph manifest (Base USDC) — **deployed and syncing** | [`subgraph/subgraph.yaml`](subgraph/subgraph.yaml) |
| Claimed-vs-settled reconciliation | [`apps/web/lib/reconcile.ts:75`](apps/web/lib/reconcile.ts#L75) |
| The rail the panel checks, named once so prose cannot drift from the query | [`apps/web/lib/claimed-vs-settled.ts:36`](apps/web/lib/claimed-vs-settled.ts#L36) |
| Seller trust from settlement history | [`apps/web/app/api/mcp/seller-trust/route.ts`](apps/web/app/api/mcp/seller-trust/route.ts) |
| **Substreams indexing skill** (generic, installable) | [`plugin/skills/index-settlements/`](plugin/skills/index-settlements/) |

### The agent's own identity — remote MCP over OAuth

A stdio MCP server is launched by one operator with one agent's key in the environment, which
is what the spec prescribes for that transport. A *remote* one cannot work that way, so it
authenticates the human and acts as their delegate.

| What | Where |
|---|---|
| Streamable HTTP MCP endpoint, OAuth-protected | [`apps/web/app/api/mcp/http/route.ts`](apps/web/app/api/mcp/http/route.ts) |
| Same seven tools as stdio — one implementation, two transports | [`packages/mcp/http.ts`](packages/mcp/http.ts) |
| Token verification: JWKS, issuer, expiry, audience | [`apps/web/lib/oauth/verify.ts`](apps/web/lib/oauth/verify.ts) |
| Protected-resource metadata (RFC 9728) | [`apps/web/lib/oauth/metadata.ts`](apps/web/lib/oauth/metadata.ts) |
| The consent screen — where a human reads what they are granting | [`apps/web/app/oauth/consent/page.tsx`](apps/web/app/oauth/consent/page.tsx) |
| **Revocation that bites at the point of use** | [`apps/web/lib/auth.ts:29`](apps/web/lib/auth.ts#L29) |

### Who is allowed to do what

Three different identities, because they answer three different questions.

**The approver holds a capability URL, and that is deliberate.** `submit_plan` returns
`/p/<planId>?k=<approvalKey>`; holding the key is the authority to decide that one plan.
There is no login on the approval page and there should not be one — approval happens
out-of-band on a phone, and putting a sign-in between the human and the decision breaks the
flow the whole product is built around. The key never reaches the browser: the page checks it
server-side and hands the form an HMAC ticket scoped to one plan for one hour instead.

**Above $5, the approver also has to prove they are human.** `STEP_UP_USD` (default 5) picks
the plans that need it; `HUMAN_VERIFIER=none` is the shipping default and `world` swaps in
World ID (enforced server-side — see the World table above). Only *approval* is gated —
making someone prove themselves to say "no" is friction that buys nothing.

**The agent holds a bearer token.** `pbt_`-prefixed, so a leak is greppable; only its sha256
is stored, so the database never holds anything that can spend.

**The human holds a session.** Supabase magic link. Agents are owned by a user, and the
console shows that user's own plans — enforced by Postgres RLS through the anon key, not by a
`where` clause the app could forget. The service-role client stays behind the agent API and
the approval capability, which both authenticate before they reach the database.

| What | Where |
|---|---|
| Approval capability URL minted | [`apps/web/app/api/mcp/plans/route.ts:62`](apps/web/app/api/mcp/plans/route.ts#L62) |
| …and checked, without the key reaching the client | [`apps/web/app/p/[id]/page.tsx:89`](apps/web/app/p/%5Bid%5D/page.tsx#L89) |
| One-hour HMAC ticket so a server action can't be called cold | [`apps/web/app/p/[id]/token.ts:22`](apps/web/app/p/%5Bid%5D/token.ts#L22) |
| Agent bearer token → sha256 lookup | [`apps/web/lib/auth.ts:14`](apps/web/lib/auth.ts#L14) |
| Token issued / rotated / revoked by its owner | [`apps/web/lib/accounts.ts:85`](apps/web/lib/accounts.ts#L85) |
| Ownership chain `auth.users → agents.owner_id → plans → …` | [`supabase/migrations/0004_accounts.sql:10`](supabase/migrations/0004_accounts.sql#L10) |
| RLS: a signed-in user reads only their own rows | [`supabase/migrations/0004_accounts.sql:37`](supabase/migrations/0004_accounts.sql#L37) |
| `token_hash` revoked from `authenticated` entirely | [`supabase/migrations/0004_accounts.sql:35`](supabase/migrations/0004_accounts.sql#L35) |
| Session required for `/console` and `/account` — and nothing else | [`apps/web/middleware.ts:5`](apps/web/middleware.ts#L5) |
| Sign-in callback — handles all three credential shapes Supabase emits | [`apps/web/app/auth/confirm/page.tsx:29`](apps/web/app/auth/confirm/page.tsx#L29) |
| Console reads as the signed-in user, under RLS | [`apps/web/app/console/page.tsx:41`](apps/web/app/console/page.tsx#L41) |

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
# add HEDERA_OPERATOR_ID / _KEY from portal.hedera.com (testnet), and your Supabase keys —
# the browser session needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY as
# well as the server-side SUPABASE_* trio
pnpm hcs:topic                      # creates the audit topic, records its id
pnpm seed:agent && pnpm register:agent
pnpm dev
pnpm driver "vet 3 counterparty wallets before I pay them"
```

`seed:agent` creates an **unowned** agent and writes its token to `.env.local`. That agent can
spend, but no signed-in user can see its plans — ownership is what the console scopes by. The
path to prefer is signing in and creating the agent from the console instead: it issues the
same `pbt_` token, shows it exactly once, and lets you rotate or revoke it without touching
the database.

Supabase's built-in SMTP allows only a few sign-in emails an hour, which is fine in normal use
and awkward during a demo. `pnpm signin:code <email>` prints the same one-time code the email
would have carried, without sending anything — a local operator script, since it needs the
service-role key and has no authorization beyond holding it.

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
- **The subgraph is deployed and syncing, and currently reconciles nothing of ours.** It
  indexes Base USDC, which is where the Bazaar's sellers are — but every payment we have
  actually made is on Hedera testnet, because testnet-first is a rule here and `MAINNET_PAY`
  defaults to false. So the panel is live and correct and shows agreement on zero. That is the
  rule working, not the panel failing. Counts read "since deployment", never "this month".
- **The panel named the wrong chain for a day.** The manifest moved to Base when Subgraph
  Studio dropped WorldChain; the query filter and the user-facing prose lived in other files
  and did not follow, so it would have reconciled one chain while claiming another. Both are
  fixed and the chain name now derives from a single constant. Recorded because a verification
  surface that silently verifies nothing is worse than none — it looks like evidence.
- **World step-up has not completed a real proof on a real device.** It completes through the
  simulator, which minted a funded envelope. On a physical phone Selfie Check returns
  `failed_by_host_app` *before our backend is called* — confirmed by zero log lines against a
  deployed logger — and `proofOfHuman` asks for an Orb the test identity does not hold. We
  shipped `deviceLegacy` as a fourth preset so the gate degrades to a weaker real proof rather
  than to an unreachable button. The full write-up went to the World team.
- **The console is scoped to the signed-in user, and Postgres is what enforces it.** Browser
  sessions read through the anon key under RLS, so the scoping survives a forgotten `where`.
  Two honest gaps: agents seeded before accounts existed have no `owner_id` and are therefore
  invisible to *every* signed-in user until claimed by an explicit update — the safe direction
  to fail, but a rough edge; and the account model landed on the last night, so it has had far
  less use than the approval path.
- **The approval page has no login, on purpose.** It is a capability URL, and that is the
  design, not a gap — see "Who is allowed to do what" above.
- **The remote MCP is verified end to end, by a client we did not write.** Claude Code was
  pointed at `https://planbound.xyz/api/mcp/http` with `claude mcp add --transport http`,
  registered itself through dynamic client registration, sent its human to our consent screen,
  and came back holding a token our resource server accepted. `quote_task` then ran through it
  for real: Bazaar discovery, four sellers, live 402 probes, $0.0260 of quotes.
  Separately, the boundary: no token → 401 with a well-formed `WWW-Authenticate` and *not* a
  redirect; a token in the query string → refused; a garbage token → 401; the RFC 9728 document
  well-formed and resolving to the Supabase issuer.
  Worth stating because it was not true for most of the build: the flow had been run only by
  the session that wrote it, and "tested" and "reported tested" are different claims. A
  third-party client closed that gap.
- **Audience binding is not the spec's mechanism, because the mechanism is unavailable.**
  RFC 8707 asks a resource server to reject tokens not issued for it. Supabase accepts the
  `resource` parameter and does not reflect it in the token — `aud` is the Postgres role
  `authenticated`. So the binding rests on a consent grant a human wrote for this exact
  resource URI, plus a required `client_id` that a session token does not carry. That is the
  spec's "or otherwise verify" branch, not its default one. The token-claim check is already
  implemented and starts binding the day Supabase populates it.
- **Revoking OAuth consent is one-sided.** It revokes ours, not Supabase's, so the next
  authorize may auto-approve without rendering our consent screen. Found and left unfixed.
- **Nine bugs were found on the last night by running the product, not by reading it.** Two
  are worth naming because they were invisible to tests: a plan told a human "worldchain" for
  sellers that only settle on Base, and revoking an agent's consent left it able to spend for
  thirty more minutes. Both are fixed. Both argue that the demo path deserves more suspicion
  than the test suite gives it.

## Team & AI use

Ido (backend, chain, agents) · Yuval (frontend, UX, docs). Built with AI agents under
documented supervision — see [`docs/AI-USAGE.md`](docs/AI-USAGE.md), the committed spec trail
in [`plans/`](plans/), and the session prompts in
[`plans/implementation/prompts/`](plans/implementation/prompts/).

MIT licensed.
