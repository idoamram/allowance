---
name: index-settlements
description: Index ERC-20 token transfers on an EVM chain with Substreams, without writing Rust. Use when the user wants onchain token movement data — "index USDC on Base", "who received this token", "did that payment actually settle", "reconcile our records against the chain" — or when a subgraph is unavailable for their chain. Resolves the chain to a verified Substreams endpoint, streams a prebuilt ERC-20 package, and returns real transfers as JSON.
---

# /index-settlements — token transfers off an EVM chain, no Rust

Substreams is the fastest way to read historical token movement off an EVM chain, but the
normal path (`substreams init` → write Rust → `cargo build` → `.spkg`) is hours of work and
a toolchain most projects don't have. **This skill skips all of it**: it streams a prebuilt,
publicly downloadable ERC-20 package against a verified endpoint, and hands back JSON.

Use it to answer "did this actually settle on chain?" independently of whatever system
*claims* it settled.

## What this does and does not do

**Does:** stream recent ERC-20 transfers (as balance changes) for one token, or all tokens,
on any of 10 EVM chains — including chains Subgraph Studio has dropped, such as World Chain.
Output is JSON on stdout, one record per balance change.

**Does not:** deploy anything, run a long-lived sink, or write to a database. This is a
*query*, not an indexing service. It reads a bounded block range and exits. There is no
hosted endpoint at the end of it.

**Does not:** work without an API key. See Prerequisites — check this before promising the
user anything.

## Prerequisites — verify, don't assume

Run the preflight before doing anything else. It checks all three and prints the exact fix:

```bash
scripts/index-token.sh --chain base --help
```

1. **`substreams` CLI** — `brew install streamingfast/tap/substreams`
2. **`jq`** — `brew install jq`
3. **A Substreams API key.** *Every* Substreams endpoint requires auth; there is no
   anonymous tier, and unauthenticated requests fail with
   `code = Unauthenticated`. Get one free at **https://thegraph.market**, then
   `export SUBSTREAMS_API_KEY=<key>`. Keys are prefixed by client type — a valid key
   starts with `server`, `web`, `worker`, `mobile`, or `hosted`. If the user has no key,
   **say so plainly and stop**; do not emit a package that cannot run.

## How to run it

```bash
# All USDC movement on World Chain in the last ~50 blocks
scripts/index-token.sh --chain worldchain \
  --token 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1 --blocks 50

# Every token, on Base, written to a file
scripts/index-token.sh --chain base --blocks 20 --json settlements.json

# A chain the registry doesn't know yet
scripts/index-token.sh --chain mychain --endpoint host:443 --rpc https://... --start 1000
```

Flags: `--chain` (required) · `--token` (optional; omit for all tokens) · `--blocks`
(default 50) · `--start` (absolute block; default is derived from the chain head) ·
`--endpoint` / `--rpc` (override the registry) · `--json FILE` · `--raw` (unfiltered
Substreams output).

Known chains live in `chains.json`: ethereum, sepolia, base, worldchain, optimism,
arbitrum, polygon, bnb, avalanche, unichain. Each entry's endpoint comes from the
Substreams docs and each RPC was probed live.

## Output shape

```json
[
  {
    "block": 32842122,
    "contract": "0x79a02482a880bce3f13e09da970dc34db4cd24d1",
    "owner": "0x1234...",
    "tx": "0xabc...",
    "value": "1500000",
    "oldBalance": "5000000",
    "newBalance": "6500000",
    "changeType": "TYPE_1"
  }
]
```

`value` is in the token's base units — **the package does not read `decimals()`**, so
divide by 10^decimals yourself (USDC is 6, not 18; getting this wrong is the most common
error here).

## Reading the results honestly

Three things to tell the user rather than paper over:

- **Balance changes, not raw `Transfer` logs.** The package derives movement from storage
  diffs. `owner` is the account whose balance moved; a transfer therefore appears as **two**
  records (sender and recipient), not one. Don't report the record count as a transfer count.
- **`changeType`** is `TYPE_1` / `TYPE_2` when the storage change was matched to a transfer
  call, `TYPE_UNKNOWN` when it could not be. Unknown ones are real balance changes whose
  cause is ambiguous — exotic tokens, rebasing, proxies. Say so rather than dropping them
  silently.
- **Zero results is a result.** A quiet token in a 50-block window returns `[]`. That is not
  a failure; widen `--blocks` before concluding anything.

## When this is the wrong tool

- **Non-EVM chains.** Solana, Bitcoin and Hedera are rejected by name with a reason. The
  ERC-20 package consumes `sf.ethereum.type.v2.Block` and cannot run against them.
- **You need a queryable API, not a one-shot read.** Deploy a subgraph, or point a
  Substreams sink at a database — both are a different, larger job than this skill.
- **You need deep history.** This streams a bounded recent range by design. Backfilling
  millions of blocks works but will be slow and will consume your quota.

## Composing with a subgraph

A subgraph gives you a queryable GraphQL endpoint but only on chains Studio still supports;
Substreams reaches chains it doesn't. Running both — a subgraph for the chain you serve
queries from, this skill for the chain you can't deploy to — covers a multi-chain product
with one data model. This repository does exactly that: `subgraph/` indexes USDC on Base,
while this skill reaches World Chain, which Subgraph Studio no longer accepts.

## Licence

MIT, same as the repository it ships in. Reuse it.
