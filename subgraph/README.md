# PlanBound settlement subgraph — Worldchain USDC

Indexes every USDC `Transfer` on Worldchain mainnet so the control plane can be checked
against consensus instead of believed.

- **Network:** `worldchain` (CAIP-2 `eip155:480`). The identifier is the one The Graph
  documents for World Chain mainnet — read off the supported-networks page on 2026-07-25,
  not guessed. The CLI does not validate network names locally; Studio does that at deploy.
- **Contract:** USDC `0x79A02482A880bCE3F13e09Da970dC34db4CD24d1`. Verified live on
  2026-07-25: contract code present, `decimals()` → 6, `symbol()` → `USDC`.
- **startBlock:** `32820000` = 2026-07-25T10:33:59Z, verified by `eth_getBlockByNumber`.

## Why this is not a mirror of our Postgres

A subgraph that re-serves rows we already own is decoration. These two questions cannot be
answered from our database at all:

1. **Claimed vs settled.** `steps.receipt` is what the control plane *claims* it paid. This
   subgraph is what *settled*. The console diffs them, so an approver can audit our backend
   without trusting our backend. The valuable direction is the one our DB is structurally
   blind to: money that left a plan wallet with no row behind it.
2. **Seller trust.** A Bazaar listing is a claim; a 402 probe proves only that the seller is
   awake. `Seller.settlementCount` / `uniquePayerCount` prove somebody actually paid them,
   which is a discovery-ranking input the agent reasons over.

## Design decision: index broadly, filter at query time

The manifest has **no address filter**, which is the one real design choice here.

Filtering in the handler against a registry was the obvious alternative and was rejected on
two counts. Plan wallets are minted per approval, so their addresses do not exist when the
manifest is written — a registry would mean redeploying the subgraph on every plan. And a
seller the agent discovers at runtime through the Bazaar would be missing from any list
pinned at build time, which defeats the point of ranking sellers we have not met before.

The cost of indexing everything is sync volume, so it was measured rather than assumed:
**Worldchain USDC emits ~1.2 `Transfer` events per 2-second block (~52k/day)**, sampled over
several ranges on 2026-07-25. At that rate the whole token is cheap, and generality is worth
more than the saving. On a busier token the tradeoff would flip, and the manifest supports
`topic1`/`topic2` indexed-argument filters (specVersion ≥ 1.2.0) as the escape hatch.

Mints and burns are skipped — a transfer to or from the zero address is supply movement, and
counting it would inflate seller trust with non-payments.

## Honesty constraints baked in

`startBlock` is recent by design so this syncs in minutes rather than days. That choice
obliges a matching claim: **"settled since deployment", never "this month"**. The
`IndexMeta` singleton records the real first-indexed block and timestamp, and the console
prints it — so the window is a fact the subgraph reports rather than a period the UI asserts.

The Graph does not index Hedera. Hedera-rail steps are therefore excluded from the
claimed-vs-settled panel rather than silently counted as unsettled.

## Local development

```sh
pnpm install --ignore-workspace   # this directory is deliberately outside the pnpm workspace
pnpm codegen                      # generated/ — AssemblyScript types from ABI + schema
pnpm build                        # compiles src/mapping.ts to build/USDC/USDC.wasm
```

It sits outside the root pnpm workspace on purpose: `graph-cli` pulls a large, unrelated
dependency tree, and four sessions were editing the root `pnpm-lock.yaml` in parallel. Its
own lockfile keeps that blast radius at zero.

## Deploying

**Not yet deployed — blocked on the Subgraph Studio deploy key.** Everything above is
validated locally (codegen and WASM build both green); nothing here has been run against
Studio.

Create the subgraph in [Subgraph Studio](https://thegraph.com/studio/) with network
**World Chain**, then, from this directory:

```sh
pnpm codegen && pnpm build
pnpm exec graph deploy <STUDIO_SLUG> --deploy-key "$GRAPH_DEPLOY_KEY" --version-label v0.0.1
```

`graph deploy` defaults to the Studio node (`https://api.studio.thegraph.com/deploy/`), so no
`--node` flag is needed. The deploy key is a secret: pass it via env, never as a literal, and
never commit it.

Then put the **query URL** Studio shows into `SUBGRAPH_URL` (see `.env.example`). Until that
is set, both consumers say so explicitly rather than falling back to our own database — an
unconfigured verification panel must look unconfigured, not empty.

## Consumers

| Where | What it reads |
|---|---|
| `apps/web/app/console/claimed-vs-settled.tsx` | `Settlement` + `IndexMeta` — the claimed-vs-settled diff |
| `apps/web/app/api/mcp/seller-trust/route.ts` | `Seller` — settlement counts as a ranking input |
| `apps/web/lib/subgraph.ts` | the GraphQL queries themselves |
| `apps/web/lib/reconcile.ts` | pure claim↔settlement matching (unit-tested) |
