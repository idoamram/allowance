# AI usage

Required disclosure, kept honest. PlanBound was built by two people working with AI agents
over one weekend at ETHGlobal Lisbon. This file says which tools, on which parts, what was
generated versus corrected, and where a human's judgement changed the outcome.

## Tools

- **Claude Code (Claude Fable 5)** — Ido's lane: backend, chains, agent tooling. One session
  acted as a *control tower* holding the plan and doing the sequential, highest-risk work
  (contract, money path, Hedera). It spawned parallel sessions in isolated git worktrees for
  work with disjoint file ownership.
- **Codex** — Yuval's lane: frontend, UX, docs. Also used independently to verify market
  claims (see "Where AI caught AI" below).
- **Playwright MCP** — browser verification of the approval page, the drift diff, and the
  approve/reject flows. Screens were checked by driving a real browser, not by asserting a
  render.
- **Supabase MCP** — migrations and schema verification against the live project.

## What the agents produced, and how it was bounded

The **product spec** (`plans/product-spec/`) went through five iterations of human-directed
argument before any code existed; the iteration trail is in `drafts/`. The **implementation
plan** (`plans/implementation/001-build.md`) was written before Phase 1 and became the
approval boundary: work inside it merged autonomously, and anything outside it — including
changes to the plan or spec themselves — required Ido explicitly.

Every parallel session's prompt is committed under
[`plans/implementation/prompts/`](../plans/implementation/prompts/). Each names its task, the
files it may not touch, the frozen contract, and its stop conditions. Sessions that hit those
conditions reported blockers instead of improvising around them — which is why several
findings below exist at all.

The **code** is agent-written and human-reviewed at the PR boundary; the PR trail (#11–#34)
is the review record. Architecture decisions were human: the envelope primitive, plan-level
rather than transaction-level approval, typed rejections as the learning signal, and every
rail change.

## Where a human changed the outcome

These are the decisions AI did not make, and would have got wrong alone:

- **Rail priority.** Ido redirected the build from Base-first to sponsor-first, then pushed
  back twice when the agent proposed retreating to Base — which produced the Substreams work
  that overturned the agent's own "this is a rewrite" conclusion.
- **Scope discipline.** The 90-minute timebox and explicit stop conditions on the Substreams
  lane were set because a submission deadline makes an unbounded stretch task dangerous.
- **Testnet-first.** "Every flow must run end to end on testnets before any mainnet variant"
  was a human rule. It is the reason the demo needs no funded wallet.

## Where AI caught AI

Worth recording, because it is the honest case for the multi-agent setup:

- **A market claim was wrong.** The Claude session sampled the x402 Bazaar with five semantic
  queries and reported a total. Codex, searching independently, found a large provider the
  first agent's query wording could never surface. The correction is preserved in the git
  history, and the lesson — search sampling gives lower bounds, never totals — changed how
  discovery was written.
- **A parallel lane caught a correctness bug in another lane's code.** The subgraph session
  noticed that `parse402` preferred the Base offer regardless of a step's declared rail, so a
  Worldchain step would have silently settled on Base and produced a receipt naming a chain
  the human never approved. Fixed in PR #28.

## What was hard, and where the agents were wrong

- **`PrivateKey.fromStringDer()` accepts raw hex and returns a different key.** The agent
  wrote a "try DER, then ECDSA" fallback that always took the wrong branch. It surfaced as
  `INVALID_SIGNATURE` at settlement, far from the cause, and cost real time — twice, because
  the first fix only covered the operator key.
- **The fee payer's signature counts toward the paid-from account's key threshold.** A
  dual-control security test passed for the wrong reason until this was understood.
- **The Graph's docs and Studio disagreed** about WorldChain, and `graph build` doesn't
  validate network names — so a fully built, tested subgraph was the first thing to discover
  the deprecation.

All three are written up for the SDK teams. Public integration logs are in
[`docs/feedback/`](feedback/); a fuller sponsor-facing version is kept privately.

## The standard we held

If a file can't be explained, it isn't ready to merge. Claims in the README and the spec are
either verified against live systems or labelled as unverified — the honesty box exists
because several things genuinely are not proven yet, and saying so is cheaper than being
caught.
