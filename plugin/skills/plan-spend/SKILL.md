---
name: plan-spend
description: Price a spending task before spending anything. Use when the user asks the agent to buy, pay for, or fetch paid data — "vet these wallets", "brief me on the market", anything that costs money to answer. Shops real x402 sellers, prints a priced plan, and gets one human approval that funds a bounded envelope.
---

# /plan-spend — shop the task, then ask once

The rule this skill exists to enforce: **the human approves a priced task, not a stream
of payments.** One approval, one ceiling, no per-call popups. Approval is not consent to
a transaction — it is the creation of the budget.

## The flow

1. **`quote_task({ goal, maxUsdPerStep? })`**
   Discovers real sellers in the x402 Bazaar, probes them for real HTTP 402 prices,
   runs a bounded self-check, and returns `steps`, `approach`, `selfCheck`, `gaps`,
   `totalUsd` and `suggestedCeilingUsd`. Free — discovery and probing cost nothing.

2. **Print the table.** Exactly this shape, one line per step plus its *why*:

   ```
   goal      vet 3 counterparty wallets before I pay them
   approach  Answer "…" with 4 independent checks — risk score, wallet age, holdings,
             sanctions screen — bought from x402 sellers on worldchain (all live-quoted), $0.03 total.

   0  [live] fraud-fusion-score          $0.0100  worldchain
          ↳ the cheapest signal that an address is already known-bad
   1  [live] farcaster-reputation        $0.0080  worldchain
          ↳ a wallet minted this week is a different counterparty than one active for years
   …
   total     $0.0260   (suggested ceiling $0.0400)
   check     1 pass, 0 fixes
   ```

3. **`submit_plan({ goal, approach, steps, ceilingUsd, tolerancePct?, expiresInMin?, selfCheck })`**
   Pass `quote_task`'s output through unchanged. Returns `{ planId, approvalUrl }`.

4. **Print `approvalUrl` and hand it to the human.** Do not attempt to render the
   approval inline: approval is deliberately out-of-band, because consent an agent can
   render is consent a prompt-injected agent can forge.

5. **`await_approval({ planId, timeoutSec })`** — then report the outcome. A timeout is
   not a rejection; the link stays valid until the plan expires.

6. **Execute inside the envelope.** `pay_and_call` per step; on a block, `report_drift`
   returns the priced exits and the diff link. `close_plan` sweeps the remainder back.
   *(These three answer `not_implemented` until the envelope lands — see below.)*

## Honesty rules — these are product behaviour, not formatting

- **`[live]` means a seller answered 402 with that price. `[est.]` means nobody did and
  the number is a listed estimate.** Render the badge from `source` verbatim. Never
  present an estimate as a quote, and never average, round away or "tidy" the gap.
- **Never invent a price.** If a step could not be quoted, it is not in the plan.
- **Read the `gaps` array aloud.** A goal the market cannot serve produces a stated gap,
  not a padded step. Say "no seller was found for sanctions screening" — do not quietly
  ship a three-step plan as if four checks happened.
- **Show the self-check.** `selfCheck.fixes` are the changes the agent made to its own
  plan before a human saw it. They are evidence, and the human is shown them anyway.
- **Never edit a quoted price by hand.** If a price looks wrong, re-run `quote_task`.
- **The ceiling is the human's call.** `suggestedCeilingUsd` is total + drift headroom;
  offer it, do not assume it.

## Choosing the ceiling and tolerance

- `ceilingUsd` must be ≥ the step total; the headroom above the total is what absorbs
  small drift without a second interruption.
- `tolerancePct` (default 20) is how far a single step may move before the gate blocks
  and the human sees a diff. Estimates drift more than live quotes — that is exactly
  why the two are labeled apart.

## When a step is blocked

Show the drift diff the way `report_drift` returns it: what is already paid and what it
delivered, the estimate against the live ask, what is left in the envelope, and the
price of each exit — finish (top up the shortfall), re-plan the rest, or abort (sweep
returns the remainder; delivered results are kept either way). The human decides on the
page, not in the terminal.

## What is not built yet

`pay_and_call`, `get_envelope` and `close_plan` answer `not_implemented` until envelope
minting (T7), the gated payment path (T9) and sweep (T11) land. If you get that answer,
say so plainly. Do not simulate a payment or a receipt.
