# World ID — developer feedback

**From:** PlanBound, ETHGlobal Lisbon 2026 — [planbound.xyz](https://planbound.xyz)

**What we built with it:** an agent proposes a spending plan; a human approves it once, and
that approval funds a bounded envelope. World ID is the step-up factor on that approval — and,
by the end, the thing that binds an account to one specific human.

**Environment:** World ID 4.0 (Managed), production app, real device.
**Versions:** `@worldcoin/idkit` 4.2.1 · `idkit-core` 4.2.2 · `idkit-server` 1.1.1 ·
`agentkit-cli` 0.2.0.
**Written:** 2026-07-25/26, the same night everything below happened, so every error string is
exact rather than remembered.

**Outcome: it works.** A real Selfie Check proof completed on a real phone, verified
server-side, and the nullifier is stored and matched against on later approvals. Getting there
took most of a night, and almost none of that time went on our own code.

This is the developer half. There is a companion **user** document, written by the person who
was holding the phone.

---

## The four that cost us the most

Ranked by the time each would have saved. All are beta-surface and documentation gaps rather
than defects in the protocol.

### 1. World App reports success, then the request fails

**The single worst moment in this integration, and a UX problem rather than an API one.**

What a person experiences:

1. They tap *Verify with World ID*.
2. World App opens, they complete the flow, and World App shows a **success screen** —
   *"Congratulations! You've successfully connected your World ID to planbound."*
3. They switch back to the browser, which says **"World ID could not verify:
   `failed_by_host_app`"**.

Both screens are honest about what they know. Neither is right about what happened. The person
is left holding two contradictory statements — about their own money — from two apps that are
supposed to be talking to each other. The one that sounds authoritative, the one with the logo
they trust, is the one that is wrong.

We hit this twice, hours apart, for two different underlying causes. The second time our
database *had* recorded the binding while the browser reported failure, so the two sides had
genuinely diverged rather than merely appearing to.

**Asks, in descending value:**

1. **Do not show a terminal success screen before the request has terminated.** The handoff
   back to the relying party is part of the flow; the success screen belongs after it.
2. **When the relying party's side fails, say so in World App.** That is the surface the user
   is looking at. A failure appearing only in a browser tab they have navigated away from is a
   failure they will attribute to the website — and, in a payments product, to the website's
   honesty.
3. **"Contact the website owner" is the wrong instruction here.** In our case the relying party
   is never called: no log line, no error, nothing to contact anyone about. It sends the user
   to the party with the least information.

Generalising, because we doubt this is specific to Selfie Check: whenever an authentication
flow spans two applications, the state has to be reconciled before either one reports an
outcome. Otherwise the gap is filled by the user's imagination, and what they imagine is that
somebody is lying to them.

### 2. The Selfie Check enrolment prerequisite is documented where a working integration never looks

`failed_by_host_app` turned out to mean **the user's World ID had never enrolled the Selfie
Check credential**.

We found that sentence only in `/world-id/sandbox/testing-selfie-check` — a *testing* page —
which states enrolment "is required for Hot state users already having the app", and that a new
user is prompted to take a selfie and run liveness and uniqueness checks, while a returning user
gets a quick Face Auth for continuity.

That is the single most important sentence about integrating this credential. It is not on the
credential's own page (`/world-id/credentials/11`), not in the integration guide, and not
surfaced by `precheck`.

Worth stating plainly: **nothing was wrong with our integration.** `selfieCheckLegacy` via IDKit
4.2.1, `allow_legacy_proofs: true`, RP signature minted server-side, proof forwarded to
`/api/v4/verify/{rp_id}`. We spent hours on a correct integration because the one precondition
lives somewhere a correct integration never sends you.

**Asks:**

1. **Put the enrolment prerequisite on the credential page.** A relying party reads
   `/credentials/11` and the integration guide. Nobody opens the sandbox testing guide until
   something is already broken.
2. **Say it in the error.** `credential_not_enrolled` instead of `failed_by_host_app` would have
   ended this in seconds — and World App could offer the enrolment there and then, since it is
   the only surface that can.

### 3. `failed_by_host_app` is unactionable, and `precheck` says everything is fine

`failed_by_host_app` names *which component* failed and nothing about *why*. It is the same
string whether the credential is unavailable, the preset is not enabled for the user, or the
proof type is unsupported by the installed World App build.

We added server-side logging of World's `code`/`detail` on the verify path specifically to catch
this, redeployed, and reproduced it — **zero log lines**. The request fails inside the host app,
before `/api/v4/verify/{rp_id}` is ever called.

Then we went looking for a signal that would have predicted it. There isn't one. The full
`precheck` response for our app, taken *after* the real-device failure:

```json
{ "id": "app_…58e1", "engine": "cloud", "is_staging": false, "name": "planbound",
  "enable_face_check": true, "is_verified": false,
  "action": { "action": "planbound-approval", "status": "active",
              "max_verifications": 1, "max_accounts_per_user": 1 },
  "can_user_verify": "yes" }
```

`can_user_verify: "yes"` — and the user could not verify.

That field is the one an integrator reaches for when deciding whether to show the button at all,
so reading `"yes"` for a request the host app will refuse makes it **worse than absent**.

**Asks:**

1. **Make `failed_by_host_app` carry a reason.** Even a coarse enum — `credential_unavailable` /
   `preset_not_enabled` / `unsupported_proof_version` — turns a dead end into a decision.
2. **Give `precheck` a preset parameter.** It currently cannot answer the question that matters:
   *will this specific credential request succeed for this app and this user?* Per-credential
   availability would let a relying party degrade gracefully — offer Selfie Check where it works
   and another factor where it doesn't — rather than discovering the answer as an error after
   the human has committed.
3. **Clarify what `can_user_verify` is about.** It appears to answer a question about the
   *action*, not about the credential the preset requests. If that is the intent, the name
   misleads; if it isn't, it is a bug. An integrator cannot tell which from the response.

`enable_face_check: true` was **not** sufficient. App-level enablement and user-level credential
availability are two different gates, and only the first is discoverable.

### 4. Nothing tells you whether your Managed app is staging or production

This one hid three other problems behind it.

The World ID 4.0 Managed setup flow never states which environment it creates. We assumed
staging and set `environment: "staging"` throughout. When `precheck` finally answered, it said
`is_staging: false` — a **production** app.

So the simulator's *"Production request detected"* was correct the entire time, and our
`environment` was the mismatch. We spent hours investigating the simulator's parser instead.

**Asks:**

1. **State the environment on the Managed setup screen** — one line, "this app is
   **production**".
2. **Include it in the `rp_not_active` error**, which is the first response a new developer
   sees.
3. The simulator error would have been far better as *"this request is for a production app; the
   simulator only accepts staging apps"* — naming what it detected about **the app**, rather
   than instructing the developer to set a field they had already set. **A wrong-but-confident
   error message costs more than a vague one**, because it sends you to audit correct code.

---

## Onboarding gaps in World ID 4.0 Managed

Each of these resolved once Portal registration completed, and each cost real time on the way
in.

### `rp_id` is a third required value, and the setup screen doesn't mention it

The Managed flow hands you an **app id** and a **signer key**. Both feel complete. But `rp_id`
is required in `rp_context` on every proof request and is the path segment of the verify
endpoint — not derivable from `app_id`, and with no public lookup.

Easier to half-miss because the verify endpoint accepts `app_id` for backward compatibility:
*verification* looks configured while *request signing* still cannot work.

**Ask:** show `rp_id` on the Managed setup screen next to the signer key, with one line saying it
is needed in `rp_context`. A two-minute fix that would have saved us an hour, and we suspect the
most common 4.0 onboarding failure.

### There is no unauthenticated way to see registration state

Minutes after enabling World ID 4.0 (Managed):

```
POST https://developer.world.org/api/v4/verify/{app_id}
{"code":"rp_not_active","detail":"RP registration is not active.","attribute":null,"app_id":"app_98ed…"}
```

Still true after ~20 minutes of polling. The docs point at `get_world_id_registration_status`,
but that is a **Developer Portal MCP tool** requiring a team API key. So a developer whose
registration is pending can either poll blind or stand up MCP auth to ask a yes/no question.

**Ask:** put the state in the error — `{"code":"rp_not_active","status":"pending"}` — or expose
it on the keyless `precheck`. A developer needs to distinguish "wait longer" from "you
misconfigured something", and currently cannot.

### `precheck` won't answer app-level questions until an action exists

The SKILL correctly says to check `enable_face_check` *before* implementing a Selfie Check flow.
But:

```
POST /api/v1/precheck/{app_id}   {"action":"planbound-approve-plan"}
{"code":"required","detail":"No action found for this app.","attribute":"action","app_id":"app_98ed…"}
```

Identical for `{}`, `{"action":""}` and `{"action":null}`. The documented way to check an
**app-level** capability requires an **action-level** resource to exist first — you must create
the thing you were told to check before building.

This is also what hid `is_staging` and `enable_face_check` from us during exactly the window we
needed them.

**Ask:** answer app-level fields when no action is supplied, or state in the SKILL that the
action must exist first.

---

## Selfie Check: preview status is discoverable only from a JSDoc comment

The credential page reads like a generally-available product. The real constraints are in the
SDK's type definitions:

```ts
interface SelfieCheckLegacyPreset {
    /** This preset only returns World ID 3.0 proofs. Use it for compatibility with older IDKit versions. */
    /** Preview: Selfie Check is currently in preview. Contact us if you need it enabled. */
    type: "SelfieCheckLegacy";
}
```

Two consequences a reader has to join up alone: it is **preview and app-gated**, and it returns
**v3 proofs only** — so `allow_legacy_proofs: true` becomes mandatory and you inherit v3
nullifier tracking alongside v4.

**Ask:** put "preview — contact us to enable" and "returns v3 proofs" on the credential page. We
designed around it only because we read the `.d.ts`.

## `max_verifications: 1` is a footgun for anything that isn't sign-in

The Portal defaults an action to `max_verifications: 1`. For a sign-in action that is sensible.
For a **step-up on a recurring operation** — our case, where the same operator approves many
spending plans — it means the second approval silently fails forever, and the first one
succeeding hides it.

Worse for testing: a **failed** attempt appears to consume the allowance too. During a build
night whose entire purpose is repeating the flow, that is punishing.

The Portal does not warn, and `precheck` reports the value without comment.

**Ask:** surface it at the point of choosing, and say whether failed attempts count.

## The simulator opens a tab and abandons it

Scanning the QR from the IDKit widget on desktop opens the simulator **in a new tab**. You
complete the verification there, and that tab then just sits there — still showing the
simulator, saying nothing. The original tab has already moved on. Nothing tells you which window
is now the real one.

A developer testing a flow hits this dozens of times an hour.

**Ask:** treat it as the OAuth-style redirect it structurally is — close the tab on completion,
or show a terminal state. Even "you can close this tab" beats silence, and `window.close()`
works for a tab the simulator itself opened.

## Simulator vs Sandbox: the docs are mid-migration and it shows

- `/world-id/idkit/integrate` → use the **simulator**, `environment: "staging"`.
- `/world-id/sandbox/*` → **Sandbox**, production-like, `environment: "sandbox"`.
- The verify API's OpenAPI schema enumerates `environment` as `production | staging` only — no
  `sandbox` — while `IDKitRequestConfig.environment` in the SDK accepts all three.

**Ask:** one page stating which path is recommended *today*, and whether sandbox proofs verify
through the same v4 endpoint.

## AgentKit CLI: `register` cannot be driven headlessly

`status` is well-behaved and genuinely useful:

```
$ npx @worldcoin/agentkit-cli@0.2.0 status 0x2eA363b5ACAA8b6b86Bd156B2336c21EbBf5073F
registered: false · humanId: null · contract: 0xA23aB2712eA7BBa896930544C7d6636a96b944dA · network: eip155:480
```

`register` blocks indefinitely with no output when stdin isn't a TTY — **including under
`--manual --format json`**, which reads like it should print call data and exit. We stopped it
twice at ~150s.

Needing a human with World App is the correct design. But:

- **Ask:** one line in `--help` saying it requires an interactive terminal.
- **Ask:** make `--manual` print unsigned call data without a proof, so an agent or CI can
  prepare the transaction for a human to sign later. That is exactly the agent-plus-human split
  AgentBook exists to serve, and it is currently the one shape the CLI cannot do.
- **Note:** `agentkit-cli@0.2.0` pulls `@worldcoin/idkit-core@2.1.0`, which npm flags as
  deprecated — a v2 dependency inside the weekend's flagship v4 tooling.

---

## What worked, and is worth keeping

Specific enough to be actionable:

- **`docs.world.org/llms.txt` is the best agent-facing docs surface of any sponsor SDK we
  touched this weekend.** Every page listed as fetchable `.md`, so an agent gets the exact page
  instead of scraping. Please keep doing this.
- **`world-id/SKILL.md` is the right format.** It names failure modes *before* you hit them —
  that `^2.x`/`^3.x` samples on the public internet won't work with v4, `IRpContext` →
  `RpContext`, the widget being controlled with no render-prop child. Each would have cost us
  time. More SDKs should ship a document written for the person about to make the common
  mistake.
- **Published test vectors for `hashSignal`.** We assert against both vectors from
  `/world-id/idkit/signatures` and they match to the byte. Publishing test vectors for a
  hash-to-field is exactly right.
- **`signRequest` is pure JS, no WASM** — runs in a Next.js server action with zero config.
- **The verify endpoint is keyless.** A backend can verify without holding a Portal credential.
  Good security design; please don't regress it.
- **The QR-to-phone handoff is genuinely good**, the consent screen is clear about which app is
  asking, and the face capture is faster than any KYC flow we have used. Once it worked, it
  really worked.

## Two things we built because of this, both better than what we planned

- **A fallback preset.** `deviceLegacy` is the only one of the four every World App holder can
  satisfy unaided — the others each need a credential the user must first go and acquire. Ours
  degrades to a weaker *real* proof rather than to an unreachable button.
- **Nullifier binding.** Proving *a* human is present stops an agent approving its own plan; it
  holds the approval link. It does not stop a **different** human with a leaked link. So we
  record the nullifier at enrolment and require later approvals to match it. That turns "someone
  alive was here" into "the person who enrolled was here", without us ever learning who they
  are.

  This is the strongest thing World ID does for our product, and we only found it by asking what
  proof-of-human actually buys. Worth making that argument in your own docs — the nullifier is
  presented mainly as an anti-double-signup device, and it is also an authorization primitive.

## One design note back to you

Because a provider can be misconfigured in ways that look like frontend bugs, we made `none` the
*default* verifier — not "none until World is configured", but `none` unless explicitly opted
in, with the World path failing **loudly** when selected and incomplete. A clone of our repo with
an empty `.env` approves plans normally.

We mention it because your own docs flag the environment-mismatch failure mode (a staging action
producing zero proofs, presenting as a frontend bug). That is a strong argument for SDKs to make
"provider absent" a first-class, obviously-working state — and 4.0 does that well by keeping
verification keyless.
