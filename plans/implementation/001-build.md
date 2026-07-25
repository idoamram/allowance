# PlanBound — Implementation Plan (001)

> **For agentic workers:** execute task-by-task with the checkboxes. Every session working
> this plan MUST first read `AGENTS.md` and `plans/product-spec/latest.md`. Work inside this
> plan flows commit→PR→merge autonomously (AGENTS.md amendment, 2026-07-25); anything
> outside it needs Ido. **Changes to this plan itself need Ido.**

**Goal:** A working, deployed PlanBound by Sun 09:00 WEST — an agent discovers real x402
sellers, returns a priced+reasoned plan, one approval funds a bounded envelope, execution
hits drift gates, receipts land on HCS, and the console shows it all.

**Architecture:** Local stdio MCP (agent key + orchestration) → Next.js API on Vercel
(policy gates, Base plan-wallet custody, Hedera envelope ops) → Supabase Postgres (plans,
decisions, insights) → Hedera testnet (envelope, HSS, HCS) + Base mainnet (x402 purchases,
discovery via Bazaar).

**Tech Stack:** pnpm workspaces · Next.js 16 (App Router) · TypeScript · `@x402/fetch` +
`@x402/evm` v2.19.x · `@hiero-ledger/sdk` v2.86.x · `@supabase/supabase-js` · viem ·
`@modelcontextprotocol/sdk` · vitest · Playwright (already available as MCP tool).

**Clock:** written Sat ~20:20. Submission Sun 09:00. Phase cut-lines are pre-agreed — cut
between phases, never mid-task.

## Global Constraints

- **Open-source rule:** no resource identifiers in code — Supabase ref, Vercel scope,
  Hedera accounts, wallet addresses, topic IDs all come from env. `.env.example` = names +
  comments only. Cloners bring their own resources.
- **Secrets:** never read `.env.local`; keygen scripts write to it directly and print only
  public values. Verify presence with `test -n`.
- **Packages (exact):** `@x402/fetch@^2.19`, `@x402/evm@^2.19`, `@hiero-ledger/sdk@^2.86`,
  `next@^16`, `@supabase/supabase-js@^2`, `viem@^2`, `@modelcontextprotocol/sdk@^1.29`,
  `zod`, `vitest`. Never the stale v1-line (`x402-express` etc.), never `@hashgraph/sdk`.
- **Rails:** Hedera **testnet** for envelope/HSS/HCS. Base **mainnet** for purchases
  (`MAINNET_PAY=false` blocks real spends until Ido flips it; discovery+probing are free
  and always allowed). No Base Sepolia in demo paths.
- **Honesty strings are product code:** `[est.]` vs `[live]` labels, "since deployment",
  drift shows sunk cost + priced exits, custody wording per latest.md — copy exact wording
  from `plans/product-spec/latest.md` §5.
- **Commit cadence:** small commits per step-group, task branch per task
  (`task/<id>-slug`), PR per task, merge yourself when green. Event rule: lumpy history
  risks disqualification.
- **Per-plan money invariants (enforced in `packages/core`, tested):**
  `ceiling >= total`; `remaining = funded - Σpaid`; per-step gate blocks when
  `liveAsk > quote * (1 + tolerancePct/100)` OR `liveAsk > remaining`; estimates gate
  against the estimate value the same way.
- **Env vars (the complete `.env.example`):**
  `APP_URL` · `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_ANON_KEY` ·
  `HEDERA_NETWORK=testnet` · `HEDERA_OPERATOR_ID` · `HEDERA_OPERATOR_KEY` (treasury) ·
  `HEDERA_POLICY_KEY` · `HCS_TOPIC_ID` (blank until T7 creates it) · `BASE_RPC_URL` ·
  `BASE_TREASURY_KEY` (funds plan wallets) · `MAINNET_PAY=false` ·
  `PLANBOUND_API_URL` · `PLANBOUND_AGENT_TOKEN` · `AGENT_EVM_KEY` (local MCP only) ·
  `WORLD_APP_ID` · `WORLD_ENV=staging` · `STEP_UP_USD=5` (verifier threshold) ·
  `DEMO_USD_PER_HBAR` (fixed demo rate).

## File Structure (locked)

```
apps/web/                    Next.js: app/p/[id] (approval), app/console, app/api/*
packages/core/               contracts: types.ts, schemas.ts (zod), money.ts (gates math)
packages/chains/             discovery.ts (Bazaar+probe) · x402pay.ts (Base) · hedera.ts (envelope)
packages/mcp/                stdio server: planbound-mcp (7 tools)
plugin/                      SKILL.md + .mcp.json  (Claude Code plugin)
scripts/                     keygen.ts · spike-hedera.ts · driver.ts (headless agent)
supabase/migrations/         0001_init.sql
plans/implementation/prompts/  committed session prompts (event rule: prompts in repo)
subgraph/                    (Phase 3) manifest + mapping
fixtures/seller/             (Phase 3, optional) sepolia fixture
```

**The contract is Tasks C1–C3.** Sessions never edit `packages/core` or migration 0001
after C-tasks merge; contract changes route through the control tower.

---

## Phase 0 — Spikes (parallel, timebox 45 min total; kill-or-confirm)

### Task S1: Hedera envelope spike

**Files:** Create `scripts/spike-hedera.ts`, `scripts/keygen.ts`
**Interfaces — Produces (consumed by T7):** confirmation + working snippets for:
`createEnvelopeAccount(agentPub, policyPub, treasuryPub, hbarAmount)` with key
`1-of-[2-of-2(agent,policy), treasury]` · co-signed transfer out · `ScheduleCreate`
full-refund with `waitForExpiry` · single-sig transfer rejected `INVALID_SIGNATURE`.

- [ ] **S1.1** `scripts/keygen.ts`: generate secp256k1 keys (viem `generatePrivateKey`),
  append names to `.env.local` directly (never print private values), print public
  address/ID only. Run it for `HEDERA_POLICY_KEY` + `AGENT_EVM_KEY`.
- [ ] **S1.2** Ido pastes `HEDERA_OPERATOR_ID`/`HEDERA_OPERATOR_KEY` into `.env.local`.
  Verify: `node -e "require('dotenv').config({path:'.env.local'}); process.exit(process.env.HEDERA_OPERATOR_ID?0:1)"`.
- [ ] **S1.3** `spike-hedera.ts` with `@hiero-ledger/sdk`: `AccountCreateTransaction` with
  nested `KeyList` threshold key as above (ECDSA keys), initial balance 5 ℏ.
- [ ] **S1.4** Transfer 1 ℏ out signed by agent+policy → expect SUCCESS. Transfer signed by
  agent alone → expect `INVALID_SIGNATURE`. Print both receipts.
- [ ] **S1.5** `ScheduleCreateTransaction` wrapping full-balance-refund to treasury,
  expiration 2 min, `waitForExpiry(true)`, sign with treasury path. Wait, verify refund
  executed at expiry via mirror node.
- [ ] **S1.6** Commit `spike(s1): hedera envelope key structure + schedule confirmed` with
  a `## Findings` note in the script header (what worked, exact error codes seen).

### Task S2: x402 payment wrapper (Base)

**Files:** Create `packages/chains/x402pay.ts`, `packages/chains/x402pay.test.ts`
**Interfaces — Produces:**
`parse402(res: Response): Quote402  // {amountUsd, network, asset, payTo, bazaarInfo?}` ·
`probe(url: string): Promise<Quote402 | null>  // free GET, parses payment-required header` ·
`payAndFetch(url, walletKey, {maxUsd}): Promise<{data: unknown, paidUsd: number, txRef: string}>`.

- [ ] **S2.1** Write failing vitest: `parse402` against a **fixture of the real CoinGecko
  header** (base64 `payment-required` captured 2026-07-25 — in repo as
  `packages/chains/fixtures/coingecko-402.txt`): asserts `amountUsd === 0.01`,
  `network === 'eip155:8453'`, USDC asset address, bazaarInfo.input present.
- [ ] **S2.2** Implement `parse402` + `probe` (x402 v2: payload may be in
  `payment-required` header (base64 JSON) or body; support both). Run test → PASS.
- [ ] **S2.3** Integration check (free, live): `probe('https://pro-api.coingecko.com/api/v3/x402/simple/price?ids=bitcoin&vs_currencies=usd')`
  returns a quote. Also probe 2 wallet-risk endpoints from the demo list.
- [ ] **S2.4** Implement `payAndFetch` with `@x402/fetch` + `@x402/evm` (`ExactEvmScheme`,
  viem account from key). Gate: throws if `MAINNET_PAY !== 'true'` or quote > maxUsd.
  Real-money test deferred to T12 — do NOT attempt before funding.
- [ ] **S2.5** Commit `feat(s2): x402 probe + pay wrapper, header parsing proven live`.

### Task S3: Discovery (Bazaar + probe) — production code, not throwaway

**Files:** Create `packages/chains/discovery.ts`, `packages/chains/discovery.test.ts`
**Interfaces — Produces (consumed by MCP `quote_task`):**
`discover(query: string, opts: {maxUsdPrice?: number, limit?: number}): Promise<Candidate[]>`
where `Candidate = {url, name, priceUsd|null, network, description, inputSchema?}` ·
`quoteSteps(candidates: Candidate[]): Promise<QuotedStep[]>` — probes each, marks
`source: 'live-402' | 'estimate'`, fills `quoteUsd` from live probe else estimate.

- [ ] **S3.1** Failing test: `discover('wallet risk scan', {limit:5})` returns ≥3 candidates
  with url+network (live API, keyless — it's free and stable enough to test against).
- [ ] **S3.2** Implement against `https://api.cdp.coinbase.com/platform/v2/x402/discovery/search`
  (+ `resources` fallback). No API key. Filter `network === 'eip155:8453'`.
- [ ] **S3.3** `quoteSteps`: for each candidate call `probe()`; live quote → `live-402`;
  probe fails/no price → `estimate` with candidate.priceUsd or category default. Dead
  endpoints (no 402, timeouts) are dropped and logged.
- [ ] **S3.4** Pin the demo fallback list: `packages/chains/demo-sellers.json` — ≥2 probed-
  alive endpoints per category (risk / age / networth / sanctions) from today's Bazaar
  results. Test asserts the file's endpoints still probe alive (skippable with env flag).
- [ ] **S3.5** Commit `feat(s3): bazaar discovery + live quoting`.

**PHASE 0 GATE (control tower):** S1 confirms key structure + schedule → T7 unblocked.
S2 parsing proven → T9 unblocked. S3 returns live candidates → T4 unblocked. Any spike
failing = redesign that piece NOW, before the skeleton hardens around it.

---

## Phase 1 — Contract + walking skeleton (sequential; core session)

### Task C1: Monorepo scaffold

**Files:** Create `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`,
`apps/web` (`create-next-app`, App Router, TS, no src dir), `packages/{core,chains,mcp}`
package.json stubs, `.env.example` (full list from Global Constraints), `vercel link`
(scope `planbound`, project `planbound`), extend `.gitignore` (`.vercel` already covered).

- [ ] **C1.1** Scaffold all of the above; `pnpm install` green; `pnpm -r build` green.
- [ ] **C1.2** `vercel link --project planbound --scope planbound --yes` → verify `.vercel/`
  ignored by git (`git status` clean of it).
- [ ] **C1.3** Commit `chore(c1): monorepo scaffold` → PR → merge.

### Task C2: Core contract — types, schemas, money math

**Files:** Create `packages/core/types.ts`, `schemas.ts`, `money.ts`, `money.test.ts`
**Interfaces — Produces (frozen after merge):**

```ts
// types.ts — the shared vocabulary, mirrors latest.md §5 model
export type QuoteSource = 'live-402' | 'estimate'
export type Rail = 'hedera' | 'base'
export type PlanStatus = 'pending_approval'|'approved'|'rejected'|'executing'|'blocked'|'settled'|'aborted'|'expired'
export type StepStatus = 'pending'|'paid'|'blocked'|'skipped'
export type DecisionOutcome = 'approved'|'rejected'|'edited'|'drift_approved'|'drift_replan'|'drift_abort'
export type DecisionTarget = 'price'|'logic'|'scope'|'service'

export interface StepInput { serviceUrl: string; serviceName: string; quoteUsd: number;
  source: QuoteSource; buys: string; why: string; rail: Rail }
export interface PlanInput { goal: string; approach: string; steps: StepInput[];
  ceilingUsd: number; tolerancePct: number; expiresInMin: number;
  selfCheck: { turns: number; fixes: string[] } }
export interface GateResult { ok: boolean; reason?: 'drift'|'over_remaining'|'expired';
  liveAskUsd: number; maxAllowedUsd: number; remainingUsd: number }
```

```ts
// money.ts
export const totalUsd = (steps: {quoteUsd:number}[]) => // sum, 6dp
export function gate(step: StepInput, liveAskUsd: number, remainingUsd: number,
  tolerancePct: number, now: Date, expiresAt: Date): GateResult
export function driftExits(plan, paidSteps, blockedStep, liveAskUsd):
  { topUpUsd: number; abortReturnsUsd: number; newTotalUsd: number }
```

- [ ] **C2.1** Failing tests first — the v1.3 demo numbers verbatim: quoted 0.70, ceiling
  1.20, steps 1–3 paid (0.60), sanctions est 0.10 asks 0.50 → `gate` blocks with
  `reason:'drift'` even though `remaining (0.60) ≥ ask (0.50)`; `driftExits` returns
  `topUpUsd: 0` (fits ceiling), `abortReturnsUsd: 0.60`, `newTotalUsd: 1.10`. Plus: ask
  within tolerance passes; ask over remaining blocks with `over_remaining`; expired blocks.
- [ ] **C2.2** Implement; `pnpm --filter core test` PASS.
- [ ] **C2.3** `schemas.ts`: zod mirrors of PlanInput/decision payloads (API validation).
- [ ] **C2.4** Commit `feat(c2): core contract - types, gates, drift math` → PR → merge.

### Task C3: Database + API contract

**Files:** Create `supabase/migrations/0001_init.sql`, `apps/web/lib/db.ts`,
`apps/web/app/api/mcp/plans/route.ts`, `apps/web/app/api/mcp/plans/[id]/route.ts`,
`apps/web/app/api/plans/[id]/decision/route.ts`
**Interfaces — Produces (frozen):**

Tables: `agents(id, name, ens, evm_address, hedera_account, token_hash, created_at)` ·
`plans(id text 'pl_*', agent_id, goal, approach, depth, total_usd, ceiling_usd,
tolerance_pct, status, self_check jsonb, approval_key, expires_at, created_at)` ·
`steps(id, plan_id, idx, service_url, service_name, quote_usd, source, buys, why, rail,
status, paid_usd, live_ask_usd, receipt jsonb, unique(plan_id,idx))` ·
`decisions(id, plan_id, outcome, target, reason, step_idx, created_at)` ·
`envelopes(plan_id pk, hedera_account, hedera_schedule_id, hcs_topic, base_address,
funded_usd, swept_usd)` · `insights(id, text, decision_id, active, created_at)`.

Routes (agent-side, `Authorization: Bearer` → sha256 match on `agents.token_hash`):
`POST /api/mcp/plans` body `PlanInput` → `{planId, approvalUrl}` ·
`GET /api/mcp/plans/:id` → `{status, decision?, envelope?}` ·
Human-side: `POST /api/plans/:id/decision` (requires `?k=approval_key`) body
`{outcome, target?, reason?, stepIdx?}` → 200.

- [ ] **C3.1** Write 0001_init.sql exactly per the tables above (enums as pg enums). Apply
  via Supabase MCP `apply_migration` to project (env-configured ref). Verify with
  `list_tables`.
- [ ] **C3.2** Seed one agent row via SQL: name `dogfood`, token = sha256 of a value Ido
  writes to `.env.local` as `PLANBOUND_AGENT_TOKEN` (script hashes from env, never prints).
- [ ] **C3.3** Failing integration test (vitest against local `next dev`): POST a valid
  PlanInput → 200 `{planId}`; wrong bearer → 401; ceiling < total → 400.
- [ ] **C3.4** Implement routes with zod validation + `db.ts` (service-role client,
  server-only). Tests PASS.
- [ ] **C3.5** Commit `feat(c3): schema + API contract` → PR → merge. **CONTRACT NOW
  FROZEN — announce in control tower.**

### Task T4: MCP server (local stdio) — quote → submit → await

**Files:** Create `packages/mcp/server.ts`, `packages/mcp/tools.ts`, `packages/mcp/README.md`,
`plugin/.mcp.json`, `plugin/skills/plan-spend/SKILL.md`
**Interfaces — Consumes:** `discovery.ts`, core types, C3 routes.
**Produces:** MCP tools (exact names/shapes — frozen):
`quote_task({goal, maxUsdPerStep?}) → {steps: StepInput[], approach, selfCheck}` ·
`submit_plan({goal, approach, steps, ceilingUsd, tolerancePct, expiresInMin}) → {planId, approvalUrl}` ·
`await_approval({planId, timeoutSec}) → {status, decision?}` ·
`get_envelope({planId}) → envelope row` ·
`pay_and_call({planId, stepIdx, params?}) → {ok, data?, paidUsd?} | {blocked, gate}` ·
`report_drift({planId, stepIdx, liveAskUsd}) → {diffUrl}` ·
`close_plan({planId}) → {sweptUsd}`.

- [ ] **T4.1** Scaffold stdio server (`@modelcontextprotocol/sdk`), register 7 tools with
  zod schemas; `pay_and_call`/`get_envelope`/`close_plan` return `not_implemented` until T9.
- [ ] **T4.2** `quote_task`: `discover()` → `quoteSteps()` → compose approach line +
  self-check loop (≤3 turns: drop dead endpoints, dedupe same-host steps, re-price;
  fixes logged). Unit test with mocked discovery.
- [ ] **T4.3** `submit_plan`/`await_approval` → C3 routes (`PLANBOUND_API_URL` +
  bearer). `await_approval` polls every 3s.
- [ ] **T4.4** `scripts/driver.ts` — the headless dogfood agent: takes a goal string, runs
  quote→submit, prints approvalUrl, awaits, prints outcome. This is our test harness AND
  the dogfooding entry point.
- [ ] **T4.5** `plugin/.mcp.json` (stdio command `pnpm --filter mcp start`) +
  `SKILL.md` (`/plan-spend` flow: call quote_task, render the priced table with [live]/
  [est.] badges + whys + logic line, submit, print approvalUrl, await, report).
- [ ] **T4.6** Commit `feat(t4): mcp server + plugin skill` → PR → merge.

### Task T5: Approval page (the human surface)

**Files:** Create `apps/web/app/p/[id]/page.tsx`, `apps/web/app/p/[id]/actions.ts`,
minimal `apps/web/app/console/page.tsx` (plans list w/ status)
**Interfaces — Consumes:** C3 tables + decision route. `?k=` approval key gates actions.

- [ ] **T5.1** `/p/[id]?k=` renders: goal · agent · logic line + self-check stamp · itemised
  table (name, why as sub-line, quote, [live]/[est.] badge) · total vs ceiling · expiry
  countdown · Approve / Reject-with-reason (typed: price/logic/scope/service + text).
  Server components + server actions; no client secrets. Match latest.html mockup copy.
- [ ] **T5.2** Playwright (MCP browser): open page → approve → API shows `approved`;
  second run: reject step with typed reason → `rejected` + decision row.
- [ ] **T5.3** Commit `feat(t5): approval page + console list` → PR → merge.

### Task T6: E2E thread + deploy — SKELETON DEMO CHECKPOINT

- [ ] **T6.1** Run `driver.ts "vet 3 counterparty wallets before I pay them"` → real
  discovery → plan in DB → approve on phone via approvalUrl → driver prints `approved`.
- [ ] **T6.2** Deploy `apps/web` to Vercel (project `planbound`); Ido sets env vars via
  dashboard/CLI (values his side). Re-run driver against prod URL.
- [ ] **T6.3** Record video segment 1 (terminal + phone). **Dogfooding is now LIVE — every
  plan any session runs from here on goes through PlanBound itself.**
- [ ] **T6.4** Commit `feat(t6): e2e skeleton on prod` → PR → merge. Control tower may now
  spawn Phase 3 sessions.

---

## Phase 2 — The money (core session; needs S1 findings + Ido's funding)

### Task T7: Hedera envelope ops

**Files:** Create `packages/chains/hedera.ts` (+test w/ testnet)
**Interfaces — Produces:**
`createEnvelope({agentPub, ceilingUsd}) → {accountId, scheduleId}` (nested key from S1;
HBAR amount = ceilingUsd / DEMO_USD_PER_HBAR; schedules full refund at plan expiry) ·
`sweepEnvelope(accountId) → {sweptUsd}` (treasury path) ·
`hcsLog(event: 'plan'|'approval'|'receipt'|'drift'|'sweep', payload) → {seq}` (one topic
from env; create once, Ido puts ID in env).

- [ ] **T7.1** Port S1 spike into real functions; vitest tagged `@testnet` (runs against
  testnet, skipped in CI-less runs).
- [ ] **T7.2** Wire into approval flow: on `approved` → create envelope + Base plan wallet
  (fund from `BASE_TREASURY_KEY` when `MAINNET_PAY=true`, else record only) → write
  `envelopes` row → `hcsLog('plan')` + `hcsLog('approval')` with plan hash.
- [ ] **T7.3** Commit `feat(t7): envelope mint + hcs trail` → PR → merge.

### Task T9: pay_and_call — gates in the payment path

**Files:** Create `apps/web/app/api/mcp/steps/pay/route.ts`; modify `packages/mcp/tools.ts`
**Interfaces — Consumes:** `x402pay.ts`, `money.gate`, envelopes row.
**Produces:** route `POST /api/mcp/steps/pay {planId, stepIdx, params}` →
`200 {data, paidUsd, txRef}` | `409 {gate: GateResult, diffUrl}`.

- [ ] **T9.1** Failing tests: mocked probe returns ask within tolerance → pays (payAndFetch
  mocked) + step→`paid` + `hcsLog('receipt')`; ask 5× estimate → 409 `drift`, step→
  `blocked`, plan→`blocked`; ask ≤ tolerance but > remaining → 409 `over_remaining`.
- [ ] **T9.2** Implement: live probe → `gate()` → pay via plan wallet key → update step +
  receipt jsonb {ask, paid, txRef, at} → HCS. MCP `pay_and_call`/`report_drift` become
  thin calls. Tests PASS.
- [ ] **T9.3** Commit `feat(t9): gated payment path` → PR → merge.

### Task T10: Drift diff UI + exits

**Files:** Modify `apps/web/app/p/[id]/page.tsx` (blocked state view), create
`apps/web/app/api/plans/[id]/drift-decision/route.ts`

- [ ] **T10.1** Blocked plan renders the drift card exactly per latest.html: paid steps
  ✓ with what they delivered + `$paid`, blocked step est→ask with (N×), `Spent · kept
  either way`, `Left in envelope`, three priced actions (`Approve step +$Δ` /
  `Re-plan step` / `Abort · $X back`).
- [ ] **T10.2** Actions: approve → step tolerance override recorded (decision
  `drift_approved`) + execution resumes; abort → `drift_abort` + sweep + plan `aborted`;
  re-plan → step `skipped` + `drift_replan` (agent re-quotes that category on next
  `pay_and_call`).
- [ ] **T10.3** Playwright: force a drift (driver with a deliberately low estimate on a
  live endpoint), walk all three exits across three runs.
- [ ] **T10.4** Commit `feat(t10): drift diff + priced exits` → PR → merge.

### Task T11: Receipt + settle + sweep

- [ ] **T11.1** Settled plan view: quoted vs paid vs swept table + per-step receipts +
  HCS topic link (hashscan URL from env-built base). `close_plan` → sweep + plan
  `settled`, `hcsLog('sweep')`.
- [ ] **T11.2** Driver full loop test on testnet-only mode. Record video segment 2.
- [ ] **T11.3** Commit `feat(t11): receipts + sweep` → PR → merge.

### Task T12: Mainnet demo run — FULL DEMO CHECKPOINT

- [ ] **T12.1** Ido: fund Base treasury (~$10 USDC + gas), flip `MAINNET_PAY=true` in prod
  env, confirm.
- [ ] **T12.2** Full run: discovery → approval on phone → real USDC to ≥2 real sellers →
  drift on the est. step → approve exit → receipts + sweep. Record segments 3–4.
- [ ] **T12.3** Any seller flake → swap from `demo-sellers.json` fallback, note in run log.

**PHASE 2 CUT LINE — everything below is enhancement. If it's 04:00 and T12 isn't done,
Phase 3 sessions get killed and all hands finish the core.**

---

## Phase 3 — Parallel hardeners (independent; one session each; spawn after T6)

*Control tower writes each session's prompt to `plans/implementation/prompts/H<N>.md`
(committed — event rule) using the template at the bottom. Sessions work ONLY their task.*

### Task H1: Learning loop (dogfood-fed)

**Files:** Create `apps/web/lib/insights.ts`, console insights panel; modify
`packages/mcp/tools.ts` (`quote_task` reads insights)
- [ ] Rule extraction: typed rejection → insight text (template per target: price → "prefer
  <cheaper tier/host> under $X for <category>"; service → down-rank host in discovery
  ordering). Insights table; `quote_task` fetches active insights via new
  `GET /api/mcp/insights` and applies: down-ranked hosts sort last, price-capped
  categories filter candidates.
- [ ] Console panel: insight list with source decision link. Copy: "learned from N real
  decisions — nothing seeded."
- [ ] Test: seed decision fixtures from actual dogfood log → assert ordering changes.

### Task H2: World verifier (pluggable step-up)

**Files:** Create `apps/web/lib/verify/{types.ts,none.ts,world.ts}`; approval page step-up
- [ ] `HumanVerifier` interface: `required(plan): boolean` (ceiling > threshold env) ·
  `challenge(plan) → {widget props}` · `verify(proof) → boolean`.
- [ ] `world.ts` against **staging** + World ID simulator (`WORLD_ENV=staging`,
  `WORLD_APP_ID` from Ido's portal). Identity Check policy "High-Value Claim" style for
  plans > $5; capture testing documentation (screenshots + notes) into
  `docs/feedback/world.md` AS YOU TEST (weekend-scoped beta).
- [ ] AgentBook registration: attempt `npx @worldcoin/agentkit-cli register` with Ido's
  World App (his 5 min); if blocked, `none` verifier stays default and World demo uses
  simulator only — both paths are per-spec.

### Task H3: Subgraph (The Graph, load-bearing)

**Decision (2026-07-25): vanilla subgraph core; Substreams only as the stretch below.**
Prize text qualifies both equally for the AI Use Case track; our workload (one contract,
~a dozen addresses, recent startBlock) gets nothing from Substreams' parallel backfill,
and the Rust/spkg pipeline is a 4am failure mode we don't need.

**Files:** Create `subgraph/` (manifest, schema.graphql, mapping.ts)
- [ ] Index USDC `Transfer` on Base mainnet, `startBlock` = deployment day, filtering in
  handler to plan-wallet addresses (from a data-source template or a registry the API
  exposes) + `demo-sellers.json` payTo addresses.
- [ ] Deploy to Subgraph Studio (Ido creates the Studio API key → env). Console
  "claimed vs settled" panel: our receipts LEFT JOIN subgraph settlements; mismatches
  highlighted. Copy: "settled since deployment".
- [ ] Seller-trust: settlement counts per payTo → exposed via
  `GET /api/mcp/seller-trust?host=` → discovery ordering input (compose with H1).
- [ ] **Stretch (only if H3 core is green early):** swap the data source to the
  **Standardized ERC-20 Transfers Substreams package** feeding the same subgraph schema
  (substreams-powered subgraph — no Rust if the prebuilt covers Base USDC; VERIFY that
  first, don't assume). Unlocks the Composable track claim ("compose two or more Graph
  products / standardized schema") with zero console changes. If the prebuilt doesn't
  fit Base USDC out of the box, stop — the core subgraph already qualifies for the AI
  Use Case track.

### Task H4: ENS authority records

- [ ] Register `planbound.eth` subname path OR set records on an existing name Ido
  controls (his call, 5 min); ENSIP-26-style text records: `planbound:agentbook`,
  `planbound:envelope` (live plan URL). Console resolves agent name → shows records.
  Sepolia ENS acceptable; label the network honestly in UI.

### Task H5: Yuval lane (human — no session)

Landing page on planbound.xyz · domain wiring to Vercel · design pass over approval/console
(tokens in `apps/web/app/globals.css`; keep manila/ink identity from latest.html) · README
structure. Coordination: PRs against `apps/web` UI files only — no API/contract files.

---

## Phase 4 — Submission (07:00–09:00, control tower + Ido)

- [ ] **F1** README: what it is · architecture diagram (from latest.html) · **exact-line
  integration pointers** (file:line for Hedera HTS/HSS/HCS, x402, Bazaar, World, Graph,
  ENS) · run-it-yourself (cloner-ready: own env, faucets) · honesty box verbatim from spec.
- [ ] **F2** `docs/AI-USAGE.md`: tools used (Claude Code + this control-tower session +
  parallel sessions), what was generated vs corrected, pointer to `plans/` +
  `plans/implementation/prompts/` as the spec/prompt trail (event rule).
- [ ] **F3** Video: assemble segments, Ido records 2–4 min narration (≥720p, no AI voice,
  no speed-ups, ≤4 bullets/slide). The drift moment is the centerpiece.
- [ ] **F4** Submit on Hacker Dashboard; per-track notes (Hedera: testnet ops file:line;
  World: testing docs; Graph: subgraph URL; ENS: records). ENS booth Sunday morning.

---

## Session prompt template (control tower fills per H-task)

```
You are a PlanBound implementation session. Read AGENTS.md and
plans/product-spec/latest.md first — they govern everything.
Your task: plans/implementation/001-build.md → Task H<N> ONLY.
Contract files (packages/core, supabase/migrations/0001) are FROZEN — if your task
seems to need a contract change, STOP and report to the control tower.
Branch: task/h<N>-<slug>. Commit small and continuously; PR when green; merge it
yourself (AGENTS.md amendment covers you). Ports: you are assigned :300<N>.
Secrets: never read .env.local; verify vars with test -n only.
When done: reply with what shipped, file:line pointers for README F1, and anything
you left honest-but-unfinished.
```

## Risk register (from the premortem — live)

1. 2-of-2 × exact scheme unverified → S1 first, T7 blocked until confirmed.
2. Seller flake → `demo-sellers.json` fallback, probed fresh at T12.
3. Funding latency → Ido bridges during Phase 1, not at T12.
4. Subgraph sync → recent startBlock only; claim "since deployment".
5. Time → cut order: H4 → H3 → H2 → H1 → T12 drift-exit variants. Core (T6+T11) is the
   floor and is never cut.
```
