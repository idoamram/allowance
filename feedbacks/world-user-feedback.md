# World ID — user feedback

**From:** PlanBound, ETHGlobal Lisbon 2026 — [planbound.xyz](https://planbound.xyz)

**Where World ID sits in the product:** an agent proposes a spending plan; a human approves it
once, and that approval releases the money. World ID is the step-up factor on that approval —
proving a human is present, and proving it is *the same* human the account is bound to.

**Tester:** Ido Amram, one of the two builders, using the product as an operator would rather
than as its author. iPhone, World App installed, production World ID, never previously
enrolled in Selfie Check.

**Method:** unscripted. Every note below is something that happened while trying to use the
feature for real, in the order it happened, over roughly six hours on the build night. Nothing
here is reconstructed — the developer document has the matching timestamps and error strings.

This is the **user** half. The companion developer document covers the API and SDK side of the
same six hours.

---

## 1. The success screen that was not a success

**The single worst moment, and the one I would fix first.**

I tapped *Verify with World ID*. World App opened. I completed the flow. World App told me:

> **Congratulations!** You've successfully connected your World ID to planbound.

I switched back to the browser, which said:

> World ID could not verify: `failed_by_host_app`

I did not know which one to believe. My instinct was that the website was broken or lying —
because the app with the logo I trust had just told me it worked. I said as much to my
co-builder at the time: *"the world app says congrats, the web app says error."*

**As a user, the damage is specific:** this is a product about money. The moment two screens
disagree about whether something worked, I stop trusting the one I have less history with —
which is never World App. A payments product cannot absorb that.

I hit this twice, hours apart, for two different underlying reasons. The second time our own
database had actually recorded the binding while the browser reported failure, so the two
sides had genuinely diverged rather than merely appearing to.

**What I wanted:** for World App not to say "Congratulations" until the relying party had
actually received something. If it fails afterwards, tell me *in World App* — that is the
screen I am looking at.

## 2. "Contact the website owner" sent me to the wrong place

The failure told me to contact the website owner. I *am* the website owner. Our logs showed
nothing at all — the request never reached us.

So the instruction pointed at the one party with the least information about what went wrong.
As a user of somebody else's app I would have emailed a support address and been told, truthfully,
that they had no record of me.

## 3. I could not find out that I needed to enrol

The cause turned out to be that my World ID had never enrolled the Selfie Check credential.

Nothing told me that. Not the error, not the app, not the credential's documentation page. We
eventually found the sentence on a **testing** page — `/world-id/sandbox/testing-selfie-check` —
which says enrolment is required for users who already have the app. I would never have opened
that page as a user, and my co-builder only found it after hours of assuming our integration
was broken.

**What I wanted:** the error to say `credential_not_enrolled`, and World App to offer me the
enrolment right there. World App is the only surface that *can* enrol me; it is strange to be
turned away by the one app able to fix it.

## 4. Asked for an Orb I do not have, with no way forward

When we switched preset to `proofOfHuman`, the flow asked for Orb verification. I do not have
an Orb verification and there is no Orb in reach.

The screen offered no alternative and no explanation of what an Orb is or how long getting one
takes. From a user's seat it reads as "you are not eligible", full stop. A line saying which
other credential would satisfy the same request would have saved the whole detour.

## 5. The simulator opens a tab and abandons it

Scanning the QR on desktop opened the simulator in a **new tab**. I completed the verification
there — and then that tab just sat there, still showing the simulator, saying nothing. The
original tab had moved on. Nothing told me which window was now the real one.

I hit this repeatedly. Every time I had to work out by hand which tab to go back to. It should
close itself, or say "you can close this tab" — the way an OAuth redirect does.

## 6. One verification per identity is a very short leash

Our action was configured `max_verifications: 1`, which is the default. I did not notice until
my second attempt failed.

The part that matters for a *tester*: a **failed** attempt appears to consume the allowance
too. So the first time anything goes wrong — a network blip, a mistap, a preset that turns out
to need a credential I lack — that identity is finished for that action. During a build night
where the whole point is to try the flow repeatedly, this is punishing, and it is not
mentioned anywhere near where you choose the setting.

## 7. What actually worked well

Not everything fought us, and the parts that worked deserve saying.

- **The QR-to-phone handoff is genuinely good.** Scan, and the right thing opens. No pairing
  code, no account linking, no waiting.
- **The consent screen inside World App is clear** about which app is asking. I never wondered
  who I was granting something to.
- **The face capture itself is fast** — noticeably faster than any KYC flow I have used.
- **Once it worked, it really worked.** The proof came back, our server verified it, and the
  binding recorded a stable identifier we could match against later. The primitive is right;
  everything above is about the seams around it.

---

## What we would ask for, in the order it would have helped us

1. **Never show a terminal success screen before the request has terminated.** Everything in
   §1 follows from this one thing.
2. **Report the relying party's failure inside World App.** It is the surface the user is
   looking at and the one they trust.
3. **Make "cannot" distinguishable from "failed".** `credential_not_enrolled` instead of
   `failed_by_host_app`, and an offer to enrol on the spot.
4. **Put the enrolment prerequisite on the credential's own page**, not only in a sandbox
   testing guide a working integration never sends you to.
5. **Close the simulator tab, or tell the user to.**
6. **Warn when an action's verification limit is 1**, and say that failed attempts count.

## What we built because of this

Two things, and both are better than what we originally planned:

- **A fourth preset, `deviceLegacy`**, so the gate degrades to a weaker real proof instead of
  an unreachable button when a human holds no strong credential.
- **Nullifier binding.** Proving *a* human is present stops an agent approving its own plan —
  it holds the approval link. It does not stop a **different** human with a leaked link. So we
  now record the nullifier at enrolment and require later approvals to match it. That turns
  "someone alive was here" into "the person who enrolled was here", without us ever learning
  who they are. It is the strongest thing World ID does for this product, and we only found it
  by asking what proof-of-human actually buys.
