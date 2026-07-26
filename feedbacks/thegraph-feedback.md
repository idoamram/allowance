# The Graph — developer feedback

**From:** PlanBound, ETHGlobal Lisbon 2026 — [planbound.xyz](https://planbound.xyz)

**What we built with it:** an agent shops a task, a human approves one priced plan, and the
purchases execute inside a bounded envelope. We index USDC settlements so the human can diff
what our control plane *claims* it paid against what actually settled on chain — and so they can
check a seller's payment history before funding it. Both answers come from The Graph rather than
from us, which is the point.

**Dates:** 2026-07-25 and 2026-07-26, written the same nights, so the error strings are exact.

**Outcome:** a subgraph indexing Base in production, plus Substreams reading World Chain — the
chain Studio told us we could not have. Both shipped.

**Read this in order.** Part 1 ends with us concluding that Substreams meant a Rust rewrite and
walking away from it. Part 2 is us coming back and finding that conclusion was wrong. We have
left the wrong turn in, because *why* we made it is the most useful thing in this document.

---

## 1. The docs and the Studio disagree about World Chain, and the CLI can't catch it

**Severity: high — this cost us a completed, tested, unusable subgraph.**

We built a subgraph targeting World Chain because
`https://thegraph.com/docs/en/supported-networks/` lists **WorldChain (`worldchain`)** as
supported for subgraphs. It still did at the time of writing.

`graph codegen` and `graph build` both succeeded. The mapping compiled to WASM. Everything
looked correct.

Then, in Studio, selecting **WorldChain**:

> ⚠️ **Subgraphs no longer supported on WorldChain**
> Substreams-Powered Subgraphs, originally intended for non-EVM chains, are no longer
> supported. … You can use Substreams to receive data from WorldChain.

So the chain was deprecated for subgraphs, the docs page hadn't caught up, and **the only
place that knows is the deploy dialog**.

**The compounding problem: `graph-cli` does not validate network names locally.** An invalid
or deprecated `network:` in `subgraph.yaml` builds cleanly and fails only at deploy. That
turns a one-line config error into a full build-and-test cycle before you learn anything.

**Asks, in order:**
1. **Validate `network:` in `graph build`** against a fetched list of currently-deployable
   networks (with an offline escape hatch). This is the highest-leverage fix: it moves the
   feedback from deploy-time to build-time, which is where every other config error surfaces.
2. Mark deprecated networks **on the supported-networks docs page** — ideally with the date
   and the recommended migration — rather than only in the Studio dropdown.
3. Have the Studio message distinguish *"this chain never supported subgraphs"* from
   *"subgraphs here were deprecated on \<date\>"*. Ours was the second, and the wording
   ("Substreams-Powered Subgraphs, originally intended for non-EVM chains") describes a
   product we weren't using — we wrote a plain AssemblyScript subgraph — so it reads as if
   it's about someone else's setup.

## 2. "Use Substreams instead" is a much bigger ask than the dialog implies

The dialog's remedy is a **Start using Substreams** button. In context that reads like a
setting to change. It isn't: standalone Substreams is a separate Rust/`.spkg` pipeline with
a different consumer model. For a team whose entire codebase is TypeScript, mid-hackathon,
that's a rewrite, not a migration.

It's also confusing next to the ecosystem signal that **substreams support was removed from
graph-node** and substreams-based subgraphs no longer work. A developer reading both in the
same hour cannot tell what is being recommended.

**Ask:** where a chain loses subgraph support, say plainly what the migration costs — new
language, new toolchain, different query surface — and link a migration guide rather than a
"start using" CTA. We'd rather be told "this is a rewrite" in one sentence than discover it
after committing.

## 3. Smaller notes

- **`startBlock` guidance is good and we followed it.** Choosing a recent block gave a
  sync-in-minutes subgraph, and it forced us into an honest UI claim ("settled since
  deployment" rather than "this month"). Worth keeping this framing in the docs — it nudges
  people toward honest product copy, which is unusual and good.
- **Deciding what to index needed a measurement, not docs.** We had to choose between
  indexing the whole USDC contract and filtering to a registry of addresses, but our plan
  wallets don't exist at manifest time. We measured the chain (~1.2 Transfer events per 2s
  block, ~52k/day) to justify indexing broadly. A "how much volume can a single data source
  comfortably handle" rule of thumb — even order-of-magnitude — would let people make that
  call without instrumenting a chain first.
- **Hedera is absent** from the supported networks list. Not a complaint; noted because our
  product settles on both Hedera and an EVM chain, and it shaped which side we could offer
  chain-verified reconciliation on.

---

# Part 2 — Substreams, as the remedy for Part 1

**Date:** 2026-07-26, same night. Written after taking the Studio dialog's advice and
actually trying Substreams for World Chain.

Context: Part 1 ends with us repointing a working subgraph to Base because Studio refuses
World Chain. We came back to Substreams to see whether the recommended remedy could give us
World Chain data after all. **Short version: yes, and much more cheaply than we feared —
the "Substreams is a Rust rewrite" assumption in Part 1 turned out to be wrong.** That is
worth telling people.

## 4. The prebuilt-package path is excellent and almost invisible

Our Part 1 conclusion was that Substreams meant learning Rust. It doesn't have to. This
works, with no Rust, no `cargo`, no build step, and no deploy:

```
substreams info https://spkg.io/streamingfast/erc20-balance-changes-v1.2.0.spkg
substreams run  https://spkg.io/streamingfast/erc20-balance-changes-v1.2.0.spkg \
  map_balance_changes -e mainnet.worldchain.streamingfast.io:443 -s <block> -t +50
```

A prebuilt `.spkg` streamed straight off a URL, against any EVM chain, because the module
consumes `sf.ethereum.type.v2.Block` rather than anything chain-specific. `substreams info`
even works **unauthenticated**, which makes it a great zero-friction first command.

This is the single best answer to "Studio dropped my chain" and we nearly missed it.

**Ask:** when the Studio dialog says *"You can use Substreams to receive data from
WorldChain"*, link **this** — a prebuilt ERC-20 package and a one-line `substreams run` —
not the `substreams init` scaffolding path. The scaffolding path is what made us read the
suggestion as a rewrite and walk away. One `run` command with a prebuilt spkg would have
changed our decision in Part 1, and it would have taken one link to do it.

## 5. Auth: the requirement is clear, but the failure arrives late and the key format is undocumented

Every endpoint requires auth — fine, and the docs say so. Two rough edges:

**a) The failure is at stream time, after the package resolves.** Unauthenticated:

```
📊 Usage Report (no data received)
Error: stream auth failure: rpc error: code = Unauthenticated desc = required
authorization token not found. Please provide a valid JWT token via
'authorization' header or an API key via 'x-api-key' header
```

Since `substreams` already knows at parse time whether `SUBSTREAMS_API_KEY` /
`SUBSTREAMS_API_TOKEN` is set, a preflight check — *"no credential found; get one at
thegraph.market"* — would be strictly better than a round trip that ends in a gRPC status.
Same class of problem as Part 1's §1: the tool could tell you locally and doesn't.

**b) The key format is only discoverable by getting it wrong.** With a junk key:

```
The api_key field's value "invali******************st" is not a valid API key,
must start with either mobile, server, web, worker or hosted.
```

That prefix rule is genuinely useful and we could not find it in the docs. It also means a
**Subgraph Studio key is not a Substreams key** — an easy and expensive assumption for
someone who already has Studio open, as we did. Worth one sentence on the authentication
page: *"Substreams keys come from thegraph.market and are prefixed `server_`/`web_`/…;
your Subgraph Studio key will not work."*

**c) No anonymous tier at all.** Understandable, but it means a developer evaluating
Substreams cannot get a single row of data before signing up. Given how good the prebuilt-
package experience is once you're in, a small unauthenticated quota — even 100 blocks —
would be a disproportionately effective demo. We'd have reached working data in Part 1
instead of Part 2.

## 6. Endpoint naming is inconsistent, and we lost time to it

The endpoint table has both shapes:

- `mainnet.worldchain.streamingfast.io:443`, `mainnet.optimism.streamingfast.io:443`
- `base-mainnet.streamingfast.io:443`, `avalanche-mainnet.streamingfast.io:443`

We guessed `mainnet.base.streamingfast.io:443` by pattern-matching from World Chain, and got

```
Error: unable to complete work within backoff time limit: call
sf.substreams.rpc.v4.Stream/Blocks: rpc error: code = Unavailable
desc = no children to pick from
```

which reads like an outage, not a typo. Two asks: normalise the hostnames if you can, and
failing that, return a clear "unknown network" for hostnames that don't resolve to a
supported chain. We briefly believed Base Substreams was down.

## 7. What we built with it (and shipped for the next team)

A reusable Claude Code skill — chain + token address in, real transfers out — wrapping the
prebuilt ERC-20 package with a verified chain→endpoint registry and preflight checks. It
covers 10 EVM chains, and it exists specifically so the next team that hits the Part 1 wall
gets to the Part 2 answer in one command instead of two days.

Notably it means our product indexes **both** its settlement rails with Graph products: a
subgraph on Base, Substreams on World Chain — the chain Studio told us we couldn't have.


## 8. `substreams run --output json` writes a plain-text trailer to stdout

Verified 2026-07-26, with a working key. The stream itself is excellent — live Worldchain
and Base data, prebuilt package, no Rust. One rough edge cost us a debugging cycle:

`--output json` emits pretty-printed JSON objects and then writes **`Completed successfully`
as plain text on stdout**, after the JSON. Anything piping to `jq -s` fails with:

```
jq: parse error: Invalid numeric literal at line 31433, column 10
```

The line number points thousands of lines away from the actual problem, so the natural
reading is "the JSON is malformed" or "the module emitted something odd" — not "there is a
status message appended". We only found it by dumping raw output and scanning for
non-JSON lines.

**Ask:** send status text to **stderr** when `--output json` is selected. stdout carrying a
machine-readable format should carry only that format; that is what makes a CLI pipeable.
Alternatively offer `--output jsonl` (one object per line), which would also remove the need
for `jq -s` entirely and make streaming consumption natural.

Our workaround, for anyone hitting the same thing: `grep -vE '^[A-Za-z]'` before `jq` —
pretty-printed JSON never begins a line with a letter at column 0.

**Positive, and worth saying:** once past that, this is the smoothest part of the whole
Graph stack. `--chain worldchain --blocks 30` returned **1677 balance changes across 30
blocks** in seconds, on a chain whose subgraph support was removed. The prebuilt-package
path genuinely rescued the use case that Part 1 lost.

---

# What we'd most want fixed, in order

1. **Link the prebuilt-`.spkg` path from the chain-deprecation dialog.** The highest-leverage
   item in this document. It converts a chain deprecation from a rewrite into a one-line
   command, and it is one hyperlink. We nearly abandoned the use case over this.
2. **Make `graph build` fail on a network Studio won't accept.** Everything else here is
   documentation drift, and drift is survivable when the toolchain catches the consequence.
   Ours didn't, so a stale docs page cost us a fully built subgraph.
3. **Preflight the Substreams credential in the CLI**, and document the key prefixes — including
   that a Subgraph Studio key is not a Substreams key.
4. **Send status text to stderr when `--output json` is selected**, or offer `--output jsonl`.
