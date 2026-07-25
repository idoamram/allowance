# PlanBound

**Your agent asks for a plan, not a payment.**

An AI agent that spends today either gets a funded key (no budget, no scope, no kill
switch) or drowns its human in per-transaction popups that get rubber-stamped — 93% of
permission prompts are approved. Neither is consent.

PlanBound makes the agent **shop the task first**: discover real x402 sellers, collect live
402 quotes, and present one priced, reasoned plan — a one-line *why* per step. A single
approval **funds a single-use envelope** with exactly the approved ceiling. The agent runs
unattended inside it and cannot exceed it, because the money isn't there to exceed. When
reality drifts from the plan, the agent hits a wall and the human gets a diff with the sunk
cost on the table — not a context-free popup.

## The spec

[`plans/product-spec/latest.md`](plans/product-spec/latest.md) — one file, five sections;
"the spec" always means this file. The iteration trail lives in
[`plans/product-spec/drafts/`](plans/product-spec/drafts/), and the visualization companion
is [`latest.html`](plans/product-spec/latest.html).

## Status

**Implementation in progress** (ETHGlobal Lisbon 2026). The build plan:
[`plans/implementation/001-build.md`](plans/implementation/001-build.md).

Rails: Hedera **testnet** (envelope accounts, HSS expiry, HCS audit trail — zero Solidity)
· Base **mainnet** (x402 purchases from real third-party sellers, discovered through the
x402 Bazaar). Integration pointers with exact file:line references land here as the code
does.

## Honesty box

Per-service policy logic is off-chain today (the 2-of-2 key makes bypassing it impossible,
not on-chain); custody on Base is bounded to one plan's ceiling and lifetime, never the
treasury; the keeperless refund covers the abandoned-plan case — partial remainders are
swept by the control plane or reclaimed by the treasury key; demo drift is our own
conservative estimate meeting a real seller's real ask; the learning history is real
decisions from building the product with itself. Everything else rides consensus.

## Team & AI use

Ido (backend, chain, agents) · Yuval (frontend, UX, docs). Built with AI agents under
documented supervision — see `docs/AI-USAGE.md` (from first code PR) and the committed
spec + prompt trail in [`plans/`](plans/).
