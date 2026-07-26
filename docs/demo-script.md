# Demo script — 3:42

The narration Ido reads while screen-recording. **Bold** is emphasis, not a stage direction.
Every figure below comes from the repo or a recorded run; anything unverified is marked
`⟨VERIFY⟩` rather than guessed.

| | Beat | Runs | What it proves |
|---|---|---|---|
| 0:00 | The problem | 0:22 | Neither option today is consent |
| 0:22 | The agent shops the task | 0:48 | Real sellers, live 402 quotes, a priced plan |
| 1:10 | One approval | 0:42 | Approval *is* the funding; World ID above $5 |
| 1:52 | Buying from inside the envelope | 0:32 | The cap and the payer are one account |
| 2:24 | Drift — the moment | 0:54 | Blocked with money still in the envelope |
| 3:18 | Close | 0:24 | Quoted = paid, remainder returned |

Optional 15s beat B (The Graph) at the end — see the appendix. Cut it if the run is tight;
the six beats above stand alone.

---

## 0:00 — The problem

**On screen:** title card, or a plain terminal. Nothing moving.

**Say:**

> An agent that spends money today has two options, and both are bad. Give it a funded key —
> no budget, no scope, no kill switch. Or ask permission for every transaction, until the
> human clicks yes without reading. **Ninety-three percent** of Claude Code permission prompts
> get approved. Neither of those is consent.

**If it fails:** nothing is live here. If the recording glitched, this is the cheapest beat to
re-take — start again from the title card.

---

## 0:22 — The agent shops the task

**On screen:** terminal.

```
pnpm driver "vet 3 counterparty wallets before I pay them"
```

Let the quoting section render, then hold on the priced table: the `[live]` / `[est.]` badges,
the `↳ why` under each step, the total and suggested ceiling.

**Say:**

> So PlanBound makes the agent shop first. One command, one goal: *vet three counterparty
> wallets before I pay them.*
>
> The agent searches the **x402 Bazaar** — Coinbase's public catalog, no key required — and
> probes what it finds with a real HTTP request. A seller either answers with a live
> four-oh-two quote or it doesn't make the plan. That's the badge on each row: **live** is a
> price the seller just quoted, **est.** is our own estimate, and we never dress one up as
> the other.
>
> What comes back is a plan. Each step says what it buys and **one line of why** it earns its
> price. One total. And nothing has been spent — this is all free reads against a real market.

**If it fails:** a dead seller is *the product working* — the agent falls back to a rival from
`packages/chains/demo-sellers.json`, say so out loud and keep going. If discovery itself is
down, run `pnpm driver --dry "…"` against the fallback list, or cut to a pre-recorded take of
this beat.

---

## 1:10 — One approval

**On screen:** the `APPROVE https://…/p/<id>?k=…` line in the terminal, then cut to the phone —
the approval page, the step-up prompt, the approve tap.

**Say:**

> That link goes to my phone. This is the only thing a human has to look at, and it renders
> **out of band** from the agent — consent an agent can render is consent a prompted agent can
> forge.
>
> The plan, at the depth I choose. Above **five dollars** approving isn't a tap: it's a
> **World ID** step-up, and it's enforced on the server, not just greyed out in the interface.
>
> And approving **is** the funding. There's no grant flag to drift out of sync with the money.
> The approval mints a **Hedera** account holding exactly the ceiling, and its key is
> *one-of — two-of-two agent and policy — or treasury*. Agent and policy together can spend.
> Neither can spend alone. The treasury can always take it back.

**If it fails:** `HUMAN_VERIFIER=none` is the shipping default and always works — the approval
link is then the whole factor; say that and move on rather than debugging World on camera. If
World is in the take, `WORLD_ENV=staging` drives the World ID simulator. Four presets exist —
`proofOfHuman` (default), `selfieCheckLegacy`, `passport`, `deviceLegacy`; `deviceLegacy`
shipped because Selfie Check could not be completed on a real device, and
[`docs/feedback/world.md`](feedback/world.md) records exactly what has and hasn't been proven
end to end. Don't claim more than that file does.

---

## 1:52 — Buying from inside the envelope

**On screen:** execution output, then a Hashscan tab showing the transfer **out of the envelope
account**.

**Say:**

> Now the agent runs unattended. Before each purchase it re-probes the seller for its live
> price, the policy co-signer checks that ask against the plan the human approved, and only
> then does it pay.
>
> Here's the part I'd point at. **The account that pays is the account that holds the cap.**
> Look at Hashscan — that transfer left the envelope itself. The thing enforcing the limit and
> the thing spending the money are one account, on one chain. There's no service in the middle
> you have to trust, and the receipt is on Hedera's consensus trail, not in our database.

**If it fails:** the seller on this rail is ours and labelled as such, so it doesn't flake — the
risk is the third-party facilitator. If settlement stalls, cut to a Hashscan tab already open
on a previous run's transfer and narrate that; the claim is about *which account paid*, and a
recorded transfer proves it just as well as a live one.

---

## 2:24 — Drift

**On screen:** the blocked step in the terminal, then the drift diff on the phone — settled
steps, what changed, three priced exits.

**Say:**

> Then this happens. And this is the whole argument.
>
> A step we estimated at **one cent** met a real seller asking **five**. The gate blocked it.
> And I want to be precise about why: **the envelope still held enough money to pay.** It
> blocked because the plan the human approved was not the plan the agent found.
>
> The human doesn't get a popup. They get a **diff**: what already settled and what it
> delivered, what changed and by how much, and three exits with a price on each — approve at
> the new price, re-plan the step, or abort and take the remainder back.
>
> A budget that only checks the balance would have paid this. That's the difference between a
> spending limit and an approved plan.

**If it fails:** this drift is staged from **our own conservative estimate**, not any seller's
price, which is exactly what makes it reproducible — no puppet seller is involved. If the
collision doesn't fire, open the drift diff on a plan that already blocked and narrate it. Say
plainly that the estimate being low is the honest real-world drift source; don't imply the
seller moved its price.

---

## 3:18 — Close

**On screen:** the receipts view — quoted vs paid vs swept, per step, with the chain reference
and the HCS topic link.

**Say:**

> Close it out. **Funded five cents. Paid three and a half from inside the envelope. Swept one
> point one five cents back.** Quoted equals paid, and the remainder came home.
>
> One sentence: everyone else gives the agent a funded wallet and enforces the limit inside
> their own service. **We give the agent zero funds and let consensus enforce the cap.**

**If it fails:** a failed sweep is not a failed demo — the guarantee is the **HSS scheduled
refund** created when the envelope was minted, which fires at expiry whether or not anyone
calls close. The receipts view says so and points at that standing schedule rather than
reporting money that didn't move. Read that line out; it's a stronger claim than the sweep.

---

## Appendix — optional beat B: The Graph (15s)

Only if there is indexed data to show. **The Graph does not index Hedera**, so the run above
has no subgraph evidence — its evidence is the HCS trail. This beat needs a Base-rail
settlement in the index.

**On screen:** the console's claimed-vs-settled panel.

**Say:**

> And you don't have to take our database's word for any of it. This panel is our claim on the
> left and **The Graph's** index of what actually settled on the right. The approver verifies
> our backend against the chain, independently of us.

**If it fails / if there's nothing indexed:** say so — "the subgraph indexes Base, and this run
was on Hedera" is a better sentence than an empty panel. Fall back to the installable
Substreams skill at [`plugin/skills/index-settlements/`](../plugin/skills/index-settlements/),
which pulls the same settlement data for any supported EVM chain with no Rust and no subgraph.

---

## Before you hit record

- `MAINNET_PAY` — leave it `false` unless the take is deliberately the mainnet upgrade. Testnet
  is the demo floor and it costs nothing.
- Have a second seller ready from `packages/chains/demo-sellers.json`; a swap mid-take is
  content, not a failure.
- Have a Hashscan tab and a settled receipts page from a previous run already open in
  background tabs. Every fallback above assumes them.
- Read the numbers as words — "five cents", "one point one five cents". Reading `$0.0115` aloud
  costs a second and lands worse.
- Watch the terminal for stale copy before you frame the shot: `scripts/driver.ts:123` still
  prints *"envelope funding is the next step (T7)"* after approval, which reads as unfinished
  on camera. ⟨VERIFY: is that line still there at record time, and does the take cut before it?⟩

## Open ⟨VERIFY⟩ items

- ⟨VERIFY: what drives execution on camera between approval and receipts. The MCP tools
  `pay_and_call`, `get_envelope` and `close_plan` are still `notImplemented` stubs
  (`packages/mcp/tools.ts:197`, `:269`), while the routes they front are live
  (`apps/web/app/api/mcp/steps/pay/route.ts`). The T12 run drove the route directly. Whatever
  the real command is, it needs to be on screen in the 1:52 beat.⟩
- ⟨VERIFY: the exact drift figures for the take. `$0.01` quoted against `$0.05` asked comes
  from the recorded T12 run; a fresh run against a live seller may collide at different
  numbers. Say the numbers on screen, not these.⟩
