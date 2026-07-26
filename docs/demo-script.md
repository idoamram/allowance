# Demo script — 2:50

What Ido reads while screen-recording. **Bold** is emphasis. Say the numbers that are on
screen, not the ones written here.

| | Beat | Runs | What it proves |
|---|---|---|---|
| 0:00 | The problem | 0:20 | Neither option today is consent |
| 0:20 | The agent shops | 0:45 | Real sellers, live 402 quotes, a priced plan |
| 1:05 | One approval | 0:40 | Approval *is* the funding |
| 1:45 | Drift | 0:40 | Blocked with money still in the envelope |
| 2:25 | Close | 0:25 | Quoted = paid, remainder returned |

**Driver:** Claude Code with the PlanBound plugin installed — `claude plugin install
planbound@planbound`. It reaches the deployed server over OAuth, which is the version that
has been run end to end. `pnpm driver "<goal>"` is the fallback if the plugin misbehaves.

---

## 0:00 — The problem

**On screen:** title card.

> An agent that spends money today has two options. Give it a funded key — no budget, no
> scope, no kill switch. Or ask permission every transaction, until the human clicks yes
> without reading. Neither one is consent.

---

## 0:20 — The agent shops

**On screen:** Claude Code. Type the goal, let the priced table render, hold on it.

```
vet 3 counterparty wallets before I pay them
```

> So PlanBound makes the agent shop first.
>
> It searches the **x402 Bazaar** — Coinbase's public catalog — and probes what it finds with
> a real HTTP request. A seller either answers with a live **402** quote or it doesn't make
> the plan. That's the badge on each row: **live** is a price the seller just quoted, **est.**
> is our estimate, and we never dress one up as the other.
>
> What comes back is a plan. Each step says what it buys and **one line of why**. One total.
> Nothing spent yet — this is all free reads against a real market.

*If a seller is dead:* the agent swaps in a rival and says so. That is the product working.

---

## 1:05 — One approval

**On screen:** the approval link, then the phone. Press **Check these sellers on chain**
before approving. Then approve.

> That link goes to my phone. It's the only thing a human looks at, and it renders **out of
> band** from the agent — consent an agent can render is consent a prompted agent can forge.
>
> Before I fund strangers a directory recommended, I can ask a question neither the listing
> nor the price can answer: **has anyone ever actually paid them?** That's **The Graph** —
> a subgraph indexing settlements on Base, read from each seller's own payout address.
>
> And approving **is** the funding. No grant flag to drift out of sync with the money. It
> mints a **Hedera** account holding exactly the ceiling, with the key *one-of — two-of-two
> agent and policy — or treasury*. Agent and policy together can spend. Neither alone. The
> treasury can always take it back.

*If World ID is in the take:* `HUMAN_VERIFIER=none` is the shipping default and always works
— the link is then the whole factor. Don't debug World on camera.

---

## 1:45 — Drift

**On screen:** the blocked step, then the drift diff on the phone.

> Then this happens, and this is the whole argument.
>
> A step quoted at one price met a seller asking more. The gate blocked it — and I want to be
> precise: **the envelope still held enough money to pay.** It blocked because the plan the
> human approved was not the plan the agent found.
>
> No popup. A **diff**: what already settled, what changed, and three exits with a price on
> each — pay the new price, re-plan, or abort and take the remainder back.
>
> A budget that only checks the balance would have paid this.

*If the collision doesn't fire:* open a plan that already blocked and narrate it. The drift
comes from our own conservative estimate, not a staged seller — say that.

---

## 2:25 — Close

**On screen:** receipts — quoted vs paid vs swept, the chain reference, the HCS topic.

> Funded. Paid from inside the envelope. Swept the remainder back. Quoted equals paid.
>
> One sentence: everyone else gives the agent a funded wallet and enforces the limit inside
> their own service. **We give the agent zero funds and let consensus enforce the cap.**

*If the sweep stalls:* the guarantee is the **scheduled refund** created when the envelope was
minted — it fires at expiry whether or not anyone calls close. That's the stronger claim.

---

## Before you hit record

- `MAINNET_PAY=false`. Testnet is the demo floor and it costs nothing.
- Open in background tabs: Hashscan on a previous transfer, and a settled receipts page.
  Every fallback above assumes them.
- Read numbers as words — "five cents", not "$0.05".
- The whole flow has been run end to end through the plugin. If a take dies, the fallback is
  always a previous run already on screen, narrated honestly as one.
