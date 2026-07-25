# PlanBound — product spec (latest)

> **Version:** v1.3, promoted to latest 2026-07-25 (ETHGlobal Lisbon). This is the agreed
> spec — "the spec" everywhere else means this file. Iteration trail in `drafts/`.
> **One line:** Your agent asks for a plan, not a payment.
> **Visualization companion:** [latest.html](./latest.html) — journeys, screens, architecture diagrams.

## 1. Idea

An agent that wants to spend must first **shop the task**: digest the goal, **discover
candidate services in the x402 Bazaar** (Coinbase's keyless public catalog), probe them for
real HTTP 402 price quotes — then **validate the plan against the goal and fix what fails**
(bounded, ≤3 turns, fixes logged) before any human sees it. The plan surfaces both the **costs** and the **logic**: a one-line *why* per
step, one sentence of approach for the whole plan. A single human approval **funds a
single-use envelope** with exactly the approved ceiling — an account, not a permission flag.
The agent runs unattended inside it and cannot exceed it, because the money isn't there to
exceed. Unspent funds sweep back automatically at expiry.

Every rejection teaches the system what this human approves, so plans clear with fewer
interruptions over time. Approval is not consent to a transaction; it is the creation of the
budget itself.

## 2. Problem ↔ Solution

Today's human-in-the-loop for agent spending is a per-transaction popup, and it fails in both
directions — each failure measured, not assumed:

- **Consent that always says yes isn't consent.** 93% of Claude Code permission prompts are
  approved (Anthropic's own data, cited in
  [The Human-in-the-Loop Illusion](https://www.resilientcyber.io/p/the-human-in-the-loop-illusion),
  2026). The popup arrives without the context to judge it, so the human rubber-stamps.
- **No total exists before execution.** Only 24.7% of x402 endpoints publish a price at all
  ([TOLL·402 census of 78,290 routes](https://theaicareerlab.com/blog/x402-pricing-report-2026),
  2026-07-10). The plan is the first moment anyone — human or agent — knows what a task costs.
- **The harm is session-shaped, not transaction-shaped.** A runaway agent session produced a
  [$6,531 AWS bill](https://www.nexgismo.com/ai-agent-budget-guards-2026) (2026); an agent
  [bought a $160 premium domain overnight](https://www.reddit.com/r/AI_Agents/comments/1sjprqz/)
  (2026-04). No single call in either was worth interrupting a human for.

| Today | With this product |
|---|---|
| Popup per transaction, no context | One priced plan per task, judged before anything runs |
| Median x402 call is $0.02 — approval ceremony costs more than the spend | The human approves the *task's* cost, at a depth they choose |
| Cap is a row in a vendor's database, in a service that fails open | Ceiling is a funded account balance; the policy gate fails closed |
| Threshold is static — $50 on day 1 is $50 on day 500 | Rejections teach the system; asking gets rarer, ceilings never widen |
| The agent's choices are opaque — approve the price, trust the logic | Each step carries a one-line why; the plan states its approach; feedback targets the logic, not just the price |
| Logs, if any | Receipts on an append-only public topic, diffed quote-vs-paid |

The reasoning is **one line per step by design**. The fatigue mechanism isn't being in the
loop — it's being handed prose to review ("models emit prose because it's cheap to generate,
not cheap to review"). A plan that arrives as an essay rebuilds the problem it solves.

**Drift is the defining moment.** A step that asks 5× its estimate at execution hits a
wall — the funds and the co-signer both refuse — and the human sees a *diff against the plan
they approved*, not a context-free popup. Discovered mid-run, the diff puts the sunk cost on
the table: what's already paid and what it delivered, what changed, and the price of each
exit — finish (top up the exact shortfall), re-plan the rest, or abort (sweep returns the
remainder; delivered results are kept either way).

### What it deliberately does not solve

- **Truth of the plan's prose.** We bind the money, not the outcome. A step's *buys* and *why*
  are the agent's claims; the bounded self-check catches steps that don't serve the goal, but
  it is the agent grading itself — the receipt shows what was paid, not whether it was worth it.
- **Prompt injection itself.** We contain the blast radius (envelope + co-sign); we don't
  prevent compromise.
- **Non-payment harm.** An agent can still delete data or send bad email. Money only.
- **Fiat and card rails.** Outside the model.
- **Treasury custody.** A compromised treasury key compromises everything above it.

## 3. Use cases

Three, each with someone already asking for it in writing:

1. **A solo dev's long-running research agent.**
   [claude-code#55779](https://github.com/anthropics/claude-code/issues/55779) requests
   exactly this: a pre-execution cost estimate before approving plan-mode tasks. Here: the
   skill prints the priced table in the terminal, the dev approves once from their phone, the
   run completes unattended inside the envelope.
2. **An agency billing AI spend to clients.** The stated motivation of the same issue:
   spend must be pre-approved against an authorized budget. The approved plan *is* the
   client estimate; the receipt (quoted / paid / swept back) *is* the invoice line.
3. **A platform team moving LangGraph agents to production.**
   [r/LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/comments/1ohnuxy/) describes hand-rolled
   budget `if/else` checks as "brittle and hard to audit." The MCP surface replaces them:
   quote, submit, await approval, pay from the envelope.

## 4. Product/market fit

### Who it's for

- **Primary — the operator of spending agents.** Dev-first: the person running the agent is
  in a terminal, and the product meets them there.
- **Secondary — the approver.** Finance, ops, a client, or the dev's own future self. They
  get a priced decision at the depth they choose, and receipts they can forward.

### The differentiation, in one sentence

*"Everyone else auto-approves under $X and interrupts above it, enforced inside their own
service. We price the whole task first, make the approval itself fund the budget, and learn
from rejections so the asking gets rarer."*

### The competitive honesty

Payman, Skyfire, Nevermined, Catena, and PayGraph all ship threshold-based human-in-the-loop
spending controls today. None of them price the task before it runs, none bind the approval
into a funded account, and none have memory — the threshold is the same on day 500 as on
day 1. Google's AP2 standardizes intent/cart mandates and is the nearest primitive to
plan-level approval; it targets merchant checkout on card rails, a different lane from agent
task budgets.

> Read from each product's public documentation and posts, July 2026. Re-verify before
> repeating publicly.

### What would demonstrate fit, and hasn't

An operator adopting a *mandatory approval step* voluntarily — friction people claim to want
and may not accept. Willingness to pay. Evidence the learning loop's value survives the
cold-start period. None of this exists yet.

## 5. Architecture

```
 HUMAN                     CONTROL PLANE               AGENT            SERVICES
   │ World ID → AgentBook       │                       │                  │
   │  task ────────────────────────────────────────────►│                  │
   │                            │                       ├─ discover ──────►│ Bazaar
   │                            │                       ├── probe ────────►│
   │                            │                       │◄── 402 quotes ───┤
   │                            │                       │ self-check ≤3:   │
   │                            │                       │ fix + re-price   │
   │◄─ priced plan + logic ─────┤◄── submit_plan ───────┤                  │
   │  approve ─────────────────►│ MINT ENVELOPE         │                  │
   │  (Selfie Check if large)   │  fund acct = ceiling  │                  │
   │                            │  2-of-2 threshold key │                  │
   │                            │  HSS sweep @ expiry   │                  │
   │                            │  HCS: plan + approval │                  │
   │                            ├── envelope ──────────►│                  │
   │                            │                       ├── re-probe all ─►│
   │                            │  (pre-flight, free)   │◄── fresh 402s ───┤
   │                            │◄─ pay_and_call ───────┤                  │
   │                            │  co-sign or refuse ──────── x402 pay ───►│
   │◄─ live feed / drift diff ──┤  HCS: receipts        │◄── 200 + data ───┤
   │  reject + reason ─────────►│ learning store ───────► shapes next plan │
```

### Surfaces

| Actor | Surface | Job |
|---|---|---|
| Agent (machine) | **MCP server, local stdio via the plugin** — `quote_task` (discover → probe → compose) · `submit_plan` · `await_approval` · `get_envelope` · `pay_and_call` · `report_drift` · `close_plan` | Framework-agnostic payment tooling; the agent key never leaves the machine |
| Dev (terminal) | **Claude Code plugin + SKILL** | Draft, price, and self-check the plan inline; print the approval link; wait |
| Approver (any device) | **Next.js app** | The plan at three depths (bound / options / itemised), drift diffs, receipts, learning console |

Approval renders **out-of-band from the agent's context** — consent an agent can render is
consent a prompt-injected agent can forge.

**Approval is the funding.** In real-money mode the approve tap is itself a wallet
signature: the human's own wallet sends the ceiling in USDC to the fresh plan wallet
(gasless for the human via EIP-3009 `transferWithAuthorization` — the same primitive x402
uses; our relayer submits). Approval and funding are one act — there is no separate "grant"
state to get out of sync with the money. (Demo/testnet mode sponsors this from the
faucet-fed treasury.)

**Custody, stated exactly.** On Base the plan wallet's key is held by the control plane:
custody exists, bounded to **one plan's ceiling for one plan's lifetime** — never the
treasury, never other plans, always expiring. On Hedera the envelope key structure gives
the treasury unilateral reclaim and denies the control plane solo spending. Roadmap: an
ERC-4337 smart-account envelope on Base (owner = human, session policy = agent + co-signer)
removes the bounded custody too — it lives on the same roadmap rung as the escrow contract.

**Keys sign where they live.** The agent's key signs on the dev's machine — the plugin runs
the MCP server locally (stdio) and calls our backend for approval state and co-signing. The
policy key signs server-side. The human's key signs in their own wallet. A hosted remote MCP
(server-held agent keys) is a later, explicitly-labeled custodial mode.

### Pluggable approval and identity

The approval mechanism is decoupled from any single provider, so integrations land as
registrations, not rewrites:

- **`ApprovalChannel`** — how a plan reaches the human: the web page is canonical; email
  magic-link, Telegram bot buttons, and push are channels that notify and deep-link into it.
- **`HumanVerifier`** — what step-up requires: `none` (dev) → World Selfie Check above the
  threshold → future factors. Policy picks the verifier per plan; the approval flow doesn't
  change.
- **`IdentityRegistry`** — how an agent proves human backing: AgentBook is the first
  provider; dev mode runs a no-op.

World therefore integrates **on the go**: build with `none`/email today, register the World
provider when app + beta access are ready. Telegram becomes one more channel, same shape.

### Discovery — the x402 Bazaar

`quote_task` shops a real market, not a config file. The [x402 Bazaar](https://docs.cdp.coinbase.com/x402/bazaar)
is Coinbase's discovery catalog: **keyless read APIs** (`GET …/x402/discovery/resources`,
`…/discovery/search?query=…`) with filters for `network`, `maxUsdPrice`, `tags`, and
`curatedOnly` — verified live 2026-07-25, HTTP 200 without credentials. Listings carry price,
schemas, and a `curated` flag; **listing is automatic** — a service appears after its first
payment settles through the CDP facilitator, testnet included.

- **Policy starts at discovery.** `maxUsdPrice` + `curatedOnly` are the allowlist applied
  *before* a candidate ever reaches the plan — the co-signer stays as the second gate.
- **Coverage caveat, hybrid catalog.** The Bazaar indexes only CDP-facilitator settlers.
  CoinGecko settles elsewhere and is reachable only directly (`pro-api.coingecko.com` —
  note the host; `api.coingecko.com` 404s). The catalog is therefore Bazaar search **plus**
  a small direct-listed set.
- **Sellers are probed, not trusted.** A listing behind a bot wall (Zapper's x402 API greets
  scripted clients with a Cloudflare challenge) fails the probe and never enters a plan —
  the probe is the reliability filter.

### Enforcement ladder, graded honestly

| Rung | Mechanism | Enforces | Grade | Status |
|---|---|---|---|---|
| 1 | Envelope account funded to the ceiling | The total | consensus | ships now |
| 2 | Expiry: HSS scheduled full-ceiling refund covers the **abandoned-plan** case; partial remainders are swept by the control plane; the treasury co-key can reclaim unilaterally at any time | Authority dies on time; funds always recoverable | consensus (abandoned) · key structure + operational (partial) | ships now |
| 3 | Envelope key `1-of-[2-of-2(agent, policy), treasury]`: spends need agent+policy; treasury alone can reclaim | Allowlist + per-step caps; bypass impossible, fails closed; recovery by key structure | key structure on-chain, policy logic off-chain | ships now |
| 4 | `ScheduleCreate` per live-quoted step; agent releases via `ScheduleSign` | The exact approved transfers and nothing else | consensus | roadmap |
| 5 | Plan-authority escrow contract | Full recipient restriction incl. Base | Solidity | post-hackathon |

### Three rails, and why *(reprioritized 2026-07-25 ~22:00, Ido's direction, spike-verified)*

Of 78,290 indexed x402 routes, 15,123 returned a live 402 quote when probed (TOLL·402,
2026-07-21): **10,249 on Base mainnet (882 providers), 3,635 on Solana, 0 on Hedera** —
`@x402/hedera` first published 2026-05-25, 5.5 months after the EVM/SVM packages. Base
Sepolia's apparent inventory (1,160 routes, 33 provider groups) is staging junk on
inspection. What changed tonight, verified live: **Worldchain (`eip155:480`) has a real
seller market** — Carbon & Cashmere's live 402s offer Worldchain USDC (the CDP facilitator
settles World) — and **an x402 payment settled end-to-end on `hedera:testnet`** through
Blocky402's hosted facilitator (spike S4, mirror-node-proven). The hackathon is
Hedera/World/Graph, so rails are priority-ordered by sponsor depth, not market depth:

| Rail | Role | Why |
|---|---|---|
| **Hedera testnet** | Envelope, co-sign, HSS sweep, HCS trail — **and Flow A's purchase itself** (our labeled reference seller, Blocky402 facilitator) | Cap enforcement and payment under one consensus. No Hedera x402 seller market or directory exists (verified 2026-07-25) — being the first working seller+facilitator loop is the story, honestly labeled |
| **Base mainnet** | **Flow B purchases** — real third-party sellers, Bazaar-discovered, USDC plan wallet | Where the market actually is (10k+ live sellers, every wallet-vetting category), and the only EVM rail The Graph will still index for us — so the claimed-vs-settled panel diffs our own money rather than an empty chain |
| **Worldchain mainnet** | Supported rail, not the demo headline | Real and verified — Carbon & Cashmere's live 402s offer `eip155:480` USDC and `parse402` selects it correctly. Demoted 2026-07-25 ~23:20 when Subgraph Studio dropped subgraph support for Worldchain; World's integration is identity (World ID step-up), which is the stronger claim anyway |
| **Base Sepolia** | **CI fixtures only — never presented as market data** | Free dev loop; deterministic drift testing via a price-controllable fixture |

The fixture boundary is a product-honesty line: demo purchases on Worldchain/Base are from
sellers we don't control, discovered through a catalog we don't control; the Hedera-rail
seller is ours and labeled as such, because that market doesn't exist yet. **Testnet-first
execution rule (Ido):** every flow must run fully end-to-end on testnets (Hedera testnet;
reference seller carrying a testnet EVM rail) before any mainnet variant; mainnet is the
final demo upgrade, not a prerequisite.

**One payment client, all rails.** The x402 v2 client is scheme-pluggable:
`new x402Client().register('eip155:*', ExactEvmScheme).register('hedera:testnet', ExactHederaScheme)` —
`pay_and_call` routes by `Step.rail` and nothing above it cares. Spike S4 proved the
Hedera path with the standard stack; T9 graduates the payer to the envelope account itself
(agent+policy co-sign the partially-signed transfer; the facilitator is the external fee
payer that completes the threshold — S1's key finding). If the Hedera purchase rail slips,
the pre-agreed degrade is envelope-only Hedera + Worldchain purchases.

### The Graph — load-bearing, not a mirror

A subgraph that duplicates our Postgres is decoration. Two uses our DB structurally cannot
provide:

1. **Claimed vs. settled.** The DB records what the control plane *claims*; the chain records
   what *settled*. The console diffs the two through the subgraph — the approver verifies
   our backend against the chain, independently of us.
2. **Seller trust from settlement history.** Indexed transfers to known seller `payTo`
   addresses become a discovery-ranking signal ("this seller settled N payments since
   indexing began") — the agent reasons over Graph data to decide who to pay. The subgraph
   starts from a recent `startBlock` so it syncs in minutes, which is why the honest claim
   is "since deployment," not "this month."

One **Base** subgraph in Studio (free dev endpoint, ~3k queries/day) serves both — that's
where Flow B's EVM settlements land, so the panel indexes our own money. *(Changed
2026-07-25 ~23:20: this said Worldchain until Subgraph Studio refused the deploy —
"Subgraphs no longer supported on WorldChain" — while the supported-networks docs page
still listed it. `graph build` does not validate network names, so it surfaced only at
deploy. Standalone Substreams, Studio's suggested remedy, is a Rust pipeline feeding a
sink rather than a GraphQL endpoint: a rewrite, not a migration.)* The Graph does not
index Hedera, so Flow A's consensus evidence is the HCS trail instead.

### Onboarding — who needs what

| Actor | Needs | Hands the product | Never hands over |
|---|---|---|---|
| Operator | World App · email · EVM wallet with USDC on Base (real-money mode only; testnet mode: nothing) | Magic-link email · World ID verification · a wallet signature at approval | Any private key |
| Agent | Locally-generated secp256k1 keypair · MCP bearer token | Public key + AgentBook proof | Its private key (stays in the dev's `.env`) |
| Control plane | Policy co-signer key (server-side) | — | — (alone it can't spend; that's the 2-of-2 point) |

The operator needs **no Hedera wallet**: one secp256k1 key is both an EVM address and a
Hedera account (ECDSA was already mandatory), and the Hedera-testnet envelope twin is funded
from the faucet-fed treasury (asset: testnet HBAR, USD-denominated at a fixed demo rate).
World is rail-independent for identity: AgentBook registration is gasless via World's own
relay; the CAIP-122 challenge and Selfie Check are off-chain signatures. AgentKit's *x402
seller-side verification*, however, is documented for EVM routes only ("your paid route can
run on any EVM chain") — so AgentKit is demonstrated on the EVM-rail purchases
(Worldchain, or Base fallback), not the Hedera rail.

**ENS, load-bearing (restored from v0).** Agents get ENS subnames with **ENSIP-26 text
records publishing current authority**: the AgentBook registration reference and the live
envelope status/approval URL. An agent's *name* resolves to *what it is currently allowed
to spend* — a third party can verify authority from the name alone, no API of ours
required. Identity that answers the question servers actually ask, not a cosmetic label.

### Development split — testnets by default, mainnet by the cent

Discovery and 402 probing are **free reads against the mainnet market** — quoting and
planning develop against real sellers at zero cost. Settlement mechanics (envelope,
co-sign, drift gates, sweep, and the Hedera-rail purchase) develop on **Hedera testnet +
testnet EVM fixtures** with faucet funds, and every flow must be green end-to-end there
first (testnet-first rule). Mainnet settlement happens only in demo runs, at $0.05–$0.50
a run. Nothing about the build requires real money until the demo take.

### Plan and decision model

```ts
type Plan = {
  planId: string
  goal: string                   // what's being bought, in the human's words
  approach: string               // the plan's logic, one sentence
  agent: string                  // ENS subname
  humanRef: string               // AgentBook registration
  steps: Step[]
  total: bigint
  ceiling: bigint                // approved; ≥ total (drift headroom)
  expiresAt: number
  depth: 'bound' | 'options' | 'itemised'
  selfCheck: { turns: number; fixes: string[] }   // bounded ≤3; logged, shown to the human
  stepTolerancePct: number       // per-step drift absorbed silently; beyond it → block + diff
}

type Step = {
  service: string
  quote: bigint
  quoteSource: 'live-402' | 'estimate'   // an estimate is never dressed as a quote
  buys: string                   // what this yields toward the goal
  why: string                    // one line: why this step earns its price
  rail: 'hedera' | 'worldchain' | 'base'
}

type Decision = {
  planId: string
  outcome: 'approved' | 'rejected' | 'edited'
  target?: 'price' | 'logic' | 'scope' | 'service'   // what the objection is about
  reason?: string                // asked only on reject / edit
  at: number
}
```

### Drift policy — narrow the window, then price the exits

1. **Pre-flight re-verify.** A 402 probe *is* the current quote and costs nothing. After
   approval, before the first spend, every `live-402` step is re-probed; movement beyond
   tolerance surfaces before any money leaves. Pre-flight cannot cover `estimate` steps —
   that residual risk is exactly why the two sources are labeled apart.
2. **Per-step gate.** The x402 flow sees the live ask before signing. The co-signer compares
   ask against quote + tolerance and against the remaining envelope — drift blocks; it never
   silently pays. Small wiggle inside tolerance is absorbed by the ceiling's headroom, which
   is what the headroom is for.
3. **Sunk cost stated plainly.** A mid-run drift diff shows the paid steps with what they
   delivered, what's left in the envelope, and the exact price of each exit: finish
   (top up the shortfall), re-plan the rest (keep delivered results), abort (sweep returns
   the remainder now).

Demo note: drift is staged by controlling **our own estimate, not any seller's price** — a
deliberately conservative estimate on an `[est.]` step meets a real seller's real ask and
blocks. Real mechanics, no puppet seller; wrong estimates are the honest real-world drift
source. The sepolia fixture (price-controllable) exists to test the *live-quote* drift path
(tier 1) deterministically in CI, which no real seller allows.

### Learning loop — three rules

1. **Learn from rejections and edits, not approvals** — approvals mostly encode fatigue.
   Rejections are typed (price / logic / scope / service) against a step's stated *why*,
   so a "no" teaches which part of the reasoning failed, not just that it failed. A
   service-typed rejection also **down-ranks that seller in future discovery** — the loop
   shapes what the agent considers, not just what gets asked.
2. **Learning narrows what gets asked, never widens what's allowed.** Ceilings are not
   learnable.
3. **Held-out check:** occasionally show a plan the system would have auto-cleared. Success
   is fewer interruptions with no rise in disagreement — not a higher approval rate.

**Cold start — nothing faked.** The history shown at demo time is the real decision log
accumulated by **using the product to build the product**: every plan we approve, reject,
or edit during development is genuine training data with genuine timestamps. Dogfooding is
the seed.

### Traps, verified 2026-07-25

- **Do not use HIP-336 allowances.** An allowance is `(owner, spender, amount)` — no expiry,
  no recipient restriction. It cannot express a plan; the spender can send the whole amount
  anywhere. Dropping it also dissolves the spender-must-pay-fees trap v0 flagged.
- **Package traps.** The live x402 client family is `@x402/*` v2.19.x; the unscoped v1-line
  (`x402-express` et al.) is stale. `hedera-agent-kit` (unscoped) is stuck at 3.8.2; the
  current package is `@hashgraph/hedera-agent-kit` v4.0.0. The SDK is `@hiero-ledger/sdk`
  v2.86.x — there is no v4.
- **World AgentKit has no `lookupHuman`.** The real flow: register the agent wallet in
  AgentBook (World ID proof; gasless relay on Base mainnet), then answer CAIP-122 signature
  challenges. Verification needs a live World API — no offline mode; plan a fallback.
- **Block Streams replace the Record Stream by default September 2026** — verify anything
  reading mirror-node data before then.
- **CoinGecko's x402 host is `pro-api.coingecko.com`** — the same path on
  `api.coingecko.com` returns 404. Verified by live probe (HTTP 402), 2026-07-25.
- **Probe sellers before planning on them.** Zapper's x402 API sits behind a Cloudflare bot
  challenge that blocks scripted clients — and our buyer *is* a bot. A listing is a claim;
  the 402 probe is the fact.
- **Scheduled transactions can't sweep "whatever remains."** A schedule wraps a concrete
  transfer with a **fixed amount**; `CryptoDelete` (which would sweep a whole balance) is
  **not schedulable**; a schedule whose account can't cover the amount at expiry **fails and
  never retries**. Consequence: the keeperless refund covers only the abandoned (zero-spend)
  plan; partial remainders need the control-plane sweep or the treasury reclaim key. Rung 2
  is graded accordingly.
- **2-of-2 × Hedera exact scheme — risk lowered, still test-first.** The scheme spec sets
  `transactionId` to the *facilitator's* account, carries client signatures in a normal
  SignatureMap, and imposes **no constraints on the sender's key structure** — ordinary
  multi-sig should compose. Verify with one testnet payment before building on it.
- **AgentKit x402 verification is EVM-route-only per its docs.** Demonstrate it on the
  Base rail; a Hedera-rail AgentKit seller is undocumented territory.

### Demo goal

**"Vet these 3 counterparty wallets before I pay them."** Chosen because the market can
serve every step: one Bazaar search for wallet-risk returned five independent sellers
(plus wallet-age, net-worth, and activity endpoints at $0.02–$0.15/call, e.g. 402.com.tr).
Redundant sellers double as live-demo resilience — a dead endpoint means the agent falls
back to a rival, which is itself the product working. Supplier-search (v1's narrative)
is retired: its services don't exist as real sellers, and inventing them re-creates the
mock-marketplace problem.

### Stack

Next.js 16 on Vercel · local stdio MCP in the plugin (`@modelcontextprotocol/sdk`) ·
Supabase (Postgres, magic-link auth) · `@hiero-ledger/sdk` · `@x402/fetch` + `@x402/evm`
(+ `@x402/hedera` for the optional Hedera rail) · Bazaar discovery API (keyless) ·
CDP facilitator (sepolia fixtures) · `@worldcoin/agentkit` (pluggable provider) ·
subgraph on Base mainnet · Claude Code plugin (SKILL + `.mcp.json`). Local-network dev,
if ever needed, targets **Solo** — Hiero Local Node is deprecated September 2026; testnet
development is unaffected.
