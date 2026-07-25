# Allowance

**Give your agents a budget, not your private key.**

An AI agent that pays for anything today does it with a funded wallet in an environment
variable. That key has no budget, no scope, and no kill switch: the agent that buys weather
data can also drain the account to any address, and afterwards nobody can say which agent
spent what.

Allowance is a control plane where a verified human funds a treasury, grants each agent a
capped allowance, sets policy, and gets a live ledger of everything spent — with the ceiling
enforced by the network rather than by application code.

## How it works

The agent never holds funds. It holds *permission* to spend from the treasury, up to a limit
recorded on-chain. Four layers, hardest first:

| Layer | Enforced by | What it does |
|---|---|---|
| Ledger | Hedera allowances (HIP-336) | The hard ceiling. Overspend is refused by consensus, not by us |
| Policy | x402 V2 lifecycle hooks | Per-service caps, allowlists, period budgets — evaluated before a payment is sent |
| Identity | World AgentKit | Binds a whole fleet to one verified human |
| Record | Hedera HCS / HSS | Append-only log of every decision and payment; scheduled resets without a keeper |

Because the hard limit lives on the ledger, it holds even if this service is offline. There is
nothing in an agent's wallet to steal, and revoking access is a single transaction setting the
allowance to zero.

## Status

**Product definition. There is no implementation yet.**

The spec is [`plans/product-spec/drafts/v0.md`](plans/product-spec/drafts/v0.md) — one file,
five sections: idea, problem ↔ solution, use cases, PMF, architecture. Nothing has been
promoted to `latest.md`, so nothing in it is settled.

It says plainly what isn't validated: there's no evidence of product/market fit yet, and no
funding figures or compliance claims about competitors, because we haven't verified them.

When code lands, this README will point at the exact lines where each integration lives.

## Layout

```
plans/
  product-spec/
    latest.md       the agreed spec — does not exist yet
    drafts/vN.md    a proposed version, in progress
    archive/vN.md   superseded versions, frozen
  NNN-slug.md       one work item
AGENTS.md           working rules for humans and AI agents
```

## Working in this repo

Conventions are in [AGENTS.md](AGENTS.md): branch, commit, and PR rules, how the spec is
versioned and promoted, and how two people working in parallel stay out of each other's way.
`CLAUDE.md` is a symlink to the same file, so every tool reads one source of truth.

## Licence

MIT — see [LICENSE](LICENSE).
