# index-settlements

**Index ERC-20 transfers on any of 10 EVM chains with Substreams — without writing Rust.**

A Claude Code skill, and a plain shell script you can run without Claude at all.

The normal Substreams path is `substreams init` → write Rust → `cargo build --target
wasm32-unknown-unknown` → pack an `.spkg`. That's hours and a toolchain. This skill streams a
**prebuilt, publicly downloadable** ERC-20 package instead, so there is no Rust, no build
step, and no deploy. You give it a chain and a token address; it gives you JSON.

It reaches chains Subgraph Studio has dropped — **World Chain** among them.

---

## Install

### As a Claude Code skill

Copy the directory into your project (or a plugin you already ship):

```bash
mkdir -p .claude/skills
cp -r index-settlements .claude/skills/
```

Claude picks it up from the frontmatter in `SKILL.md`. Ask it to "index USDC on Base" and it
will run the script, read the output, and interpret it.

### As a plain script

No Claude required — the script is self-contained apart from `chains.json` next to it:

```bash
./index-settlements/scripts/index-token.sh --chain base --blocks 20
```

---

## Prerequisites

| | Install | Why |
|---|---|---|
| `substreams` CLI | `brew install streamingfast/tap/substreams` | streams the package |
| `jq` | `brew install jq` | parses the chain registry and output |
| **API key** | https://thegraph.market | **required — see below** |

Non-macOS install instructions: <https://docs.substreams.dev/how-to-guides/installing-the-cli>

### The API key is not optional

**Every Substreams endpoint requires authentication. There is no anonymous tier.** An
unauthenticated request fails with:

```
Error: stream auth failure: rpc error: code = Unauthenticated
desc = required authorization token not found.
Please provide a valid JWT token via 'authorization' header
or an API key via 'x-api-key' header
```

Get a key — free tier available — at **<https://thegraph.market>**, then:

```bash
export SUBSTREAMS_API_KEY=server_xxxxxxxxxxxx
```

Valid keys are prefixed by client type: `server`, `web`, `worker`, `mobile`, or `hosted`.
The CLI also accepts a JWT in `SUBSTREAMS_API_TOKEN` (`substreams auth` mints one from the
same key); either variable satisfies the preflight.

Quota and rate limits are set by your plan on The Graph Market, not by this skill.

---

## Usage

```bash
# USDC on World Chain, last ~50 blocks
./scripts/index-token.sh \
  --chain worldchain \
  --token 0x79A02482A880bCE3F13e09Da970dC34db4CD24d1 \
  --blocks 50

# Every token on Base, saved to a file
./scripts/index-token.sh --chain base --blocks 20 --json settlements.json

# A chain not in the registry
./scripts/index-token.sh --chain mychain \
  --endpoint mychain.example.io:443 --rpc https://rpc.mychain.io --start 1000
```

| Flag | Default | Meaning |
|---|---|---|
| `--chain` | *required* | key from `chains.json` |
| `--token` | all tokens | contract address to filter to |
| `--blocks` | `50` | how many blocks to stream |
| `--start` | derived from head | absolute start block |
| `--endpoint` / `--rpc` | from registry | override for unlisted chains |
| `--json FILE` | — | also write results to a file |
| `--raw` | — | unfiltered Substreams output |

### Supported chains

`ethereum` · `sepolia` · `base` · `worldchain` · `optimism` · `arbitrum` · `polygon` ·
`bnb` · `avalanche` · `unichain`

Endpoints are transcribed from the [Substreams chains and endpoints
docs](https://docs.substreams.dev/reference-material/chain-support/chains-and-endpoints);
each chain's public RPC (used only to resolve the head block) was probed live. Solana,
Bitcoin and Hedera are rejected **by name with a reason** rather than a generic error —
the ERC-20 package consumes `sf.ethereum.type.v2.Block` and cannot run against them.

---

## Output

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

Three things that will bite you if nobody says them out loud:

- **`value` is in base units.** The package does not call `decimals()`. USDC is 6 decimals,
  not 18.
- **These are balance changes, not `Transfer` logs.** One transfer produces **two** records —
  sender and recipient. Record count is not transfer count.
- **`changeType`** is `TYPE_1`/`TYPE_2` when the storage change was matched to a transfer
  call, `TYPE_UNKNOWN` when it wasn't. Unknown records are real movements with an ambiguous
  cause; don't drop them silently.

An empty array is a legitimate result — the token may not have moved in that window.

---

## How it works

1. Resolves `--chain` to a Substreams endpoint via `chains.json`.
2. Reads the chain head with `eth_blockNumber` over public RPC, and picks a start block a
   little behind it (the very tip may not be indexed yet).
3. Runs `substreams run` against the pinned prebuilt package
   [`streamingfast/erc20-balance-changes-v1.2.0`](https://spkg.io/streamingfast/erc20-balance-changes-v1.2.0.spkg),
   module `map_balance_changes`.
4. Filters to `--token` and reshapes with `jq`.

The `.spkg` is **pinned by version** on purpose — an unpinned `latest` would change the
output schema under you. Override with `SUBSTREAMS_SPKG` / `SUBSTREAMS_MODULE` if you want a
different package.

## Limitations

- **Filtering is client-side.** The prebuilt package takes no address parameter, so the
  stream carries every token in the range and `--token` filters afterwards. Fine for recent
  windows; wasteful for large backfills.
- **Bounded range, not a service.** This is a query that exits, not a running indexer. For a
  queryable API you want a subgraph or a Substreams sink writing to a database — a larger
  job than this.
- **Balance-change semantics** as described above.

## Composing with a subgraph

Subgraphs give you a queryable GraphQL endpoint, but only on chains Subgraph Studio still
supports. Substreams reaches chains it doesn't. Running both covers a multi-chain product:
a subgraph where you can deploy one, this skill where you can't. The project this ships in
does exactly that — a subgraph indexes USDC on Base, this skill reaches World Chain, which
Studio no longer accepts for subgraphs.

## Licence

MIT.
