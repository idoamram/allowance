# Demo script — about 3 minutes

**The Graph's track wants 2–4 minutes. Hedera's wants under 5.** Read at a normal pace and this
lands around three.

Six takes, one screen each, recorded separately — nothing depends on the take before it. Read
the **bold** lines like you mean them. Setup instructions are at the bottom; read those first
if you have not recorded yet.

---

## 1 · You, on camera — 20 seconds

*Nothing on screen but you.*

> I'm Ido, and this is PlanBound.
>
> An agent that spends money today has two options, and both of them are bad.
>
> You give it a funded wallet — no budget, no scope, no kill switch, and you find out what it
> did afterwards. Or you approve every single transaction, one popup at a time, until you stop
> reading them and just click yes. Ninety-three percent of Claude Code permission prompts get
> approved.
>
> **Neither one of those is consent.** So we built the third option.

---

## 2 · Claude Code — 40 seconds

*Type the goal. Wait for the table. Talk over the finished table, not while it works.*

```
vet 3 counterparty wallets before I pay them
```

> Here's a real job. I'm about to send money to three addresses I've never dealt with, and
> before I do, I want them checked.
>
> Instead of asking me for permission, the agent goes shopping. It searches the x402 Bazaar —
> Coinbase's public catalog of paid APIs — and then it does something a catalog listing can't
> do for it: it sends a real HTTP request to each seller and asks for a price.
>
> What comes back is a plan. Four independent checks. A sanctions screen, a fraud score, wallet
> age, and holdings. **Each row says what it buys, what it costs, and one line of why it earns
> its price** — paying a sanctioned address is the one mistake whose cost is legal rather than
> financial, so that check is on the list.
>
> Every one of these is marked **live** — that's a price a seller quoted seconds ago, not an
> estimate. Two point six cents for the whole task. **And nothing has been spent yet.** All of
> this is free.

---

## 3 · Your phone — the approval — 45 seconds

*Open the link. Scroll to the steps. Press **Check these sellers on chain**, wait for the
numbers. Then verify with World ID, then approve.*

> This link is the only thing a human ever has to look at. And it renders on our server, not
> in the agent's terminal — **consent that an agent can draw is consent a prompted agent can
> forge.**
>
> Before I fund four strangers a directory recommended, I can ask one more question that
> neither the listing nor the price can answer: has anyone ever actually paid them? That's a
> subgraph we deployed on The Graph, reading each seller's own payout address off Base. Real
> settlements, real payers, and the seller doesn't get to write it.
>
> This ceiling asks for a human factor, so I prove one with World ID. Not just that a human is
> here — that it's the same human this account is bound to. A leaked link isn't enough.
>
> And now the important part. **Approving is the funding.** There's no permission flag that
> can drift out of sync with the money. This creates a Hedera account holding exactly four
> cents and nothing else, keyed so that the agent and the policy signer must both sign, and
> the treasury can always take it back. **The agent can propose a payment. It can never
> complete one alone.**

---

## 4 · The blocked step — 40 seconds

*Show the step that blocked in the terminal, then the diff on your phone.*

> Now the agent runs unattended, and then this happens — and this is the whole argument.
>
> Before each purchase it re-checks the seller's live price. One of them came back asking more
> than it quoted. The payment stopped.
>
> And I want to be precise about why it stopped: **the envelope still had enough money in it to
> pay.** A spending limit would have paid this. It stopped because the plan I approved was not
> the plan the agent found.
>
> I don't get a popup asking me to approve a number I have no context for. I get a diff — what
> already settled and what it bought, what changed and by how much, and **three ways out with a
> price on each one**: pay the new price, re-plan the rest, or abort and take the remainder
> back.

---

## 5 · The receipts — 30 seconds

*Show the receipts view. Read the numbers on your screen.*

> Close it out. Funded, paid from inside the envelope, and the remainder swept back to the
> treasury. Quoted equals paid, and every cent is accounted for.
>
> These aren't our database's numbers. The payments left the envelope account itself, the
> receipts are on a public Hedera consensus topic, and the console diffs what we claim against
> what The Graph says actually settled. **You can check us without trusting us.**

---

## 6 · The close — 15 seconds

*Back to your face, or the landing page.*

> Everyone else in this space gives the agent a funded wallet and enforces the limit inside
> their own service. If that service fails open, the money is gone.
>
> **We give the agent zero funds, and let consensus enforce the cap.**
>
> It's live at planbound.xyz, and the whole thing is open source.

---

## If something breaks while recording

Say what happened and keep going — a real system doing something unexpected is not a failed
demo.

- **A seller is dead** → the agent swaps in another. That is the product working. Say so.
- **The sweep doesn't fire** → the refund was scheduled the moment the envelope was minted and
  fires at expiry regardless. Say that instead; it is the stronger claim.
- **Anything else** → show a previous run that worked, and say plainly it's a previous run.

---

## How to record it

**Use QuickTime.** It is already on the Mac and it will not fight you.

`File → New Screen Recording`. Before you press record:

1. **Options → Microphone → MacBook Pro Microphone.** Without this you get a silent video. It
   is the single most common way this goes wrong.
2. **Options → Show Mouse Clicks.** Judges need to see where you pressed.
3. Record **one window**, not the whole desktop — drag a box around the terminal, or the
   browser. Nobody needs your dock or your other tabs.

### Your face

Record takes 1 and 6 with `File → New Movie Recording` — that's the camera. Everything in
between is screen only, with your voice over it.

**Don't use a floating picture-in-picture bubble.** It covers something on every screen, it's
fiddly to place, and if it goes wrong you lose the take. A face at the start and end plus clean
screen recordings is faster to shoot and reads more confident.

### Stitching it together

Open **iMovie**, drag the clips in, in order, trim the dead air at the front and back of each.
Export 1080p. No titles, no music, no transitions.

### Before you press record

- `Focus → Do Not Disturb`.
- Approval link already open on your phone, phone already unlocked.
- Zoom the terminal up two sizes. It gets watched in a small window.
- Say the take number out loud at the start of each clip — it makes them trivial to order.
- **Read money as words.** "Two point six cents", not "zero point zero two six dollars".

### If you run out of time

**Record 3 and 4 first.** The approval page and the blocked step are the product. Everything
else can be cut and the video still makes the argument.
