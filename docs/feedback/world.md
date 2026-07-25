# World — integration log

Written as we went, ETHGlobal Lisbon, 2026-07-25/26. Task H2 (`plans/implementation/001-build.md`).
Everything below is a thing we actually ran, with the exact string it returned. Where we
did not get something working, it says so.

**Versions pinned at the time of writing:** `@worldcoin/idkit` 4.2.1 · `@worldcoin/idkit-core`
4.2.2 · `@worldcoin/idkit-server` 1.1.1 · `@worldcoin/agentkit-cli` 0.2.0.
**Environment:** `staging`, against the World ID simulator.
**App:** created in the Developer Portal with **World ID 4.0, Managed** (the Portal owns RP
registration and the on-chain side; we hold only the signer key).

---

## What worked first try

- **`docs.world.org/llms.txt` is the fastest path in.** The index lists every page as a
  `.md`, so an agent can `curl` the exact page instead of scraping the site. Better than
  every other sponsor SDK we touched this weekend.
- **`docs.world.org/world-id/SKILL.md` is a genuinely good agent-facing document** — it
  names the gotchas (`^2.x`/`^3.x` samples on the public internet will not work with v4,
  `IRpContext` → `RpContext`, the widget is controlled and has no render-prop child) before
  you hit them. Three of those would have cost us time each. This is the right format.
- **`signRequest` from `@worldcoin/idkit/signing` is pure JS, no WASM.** It runs inside a
  Next.js server action with no config. `{ sig, nonce, createdAt, expiresAt }` out.
- **`hashSignal` from `@worldcoin/idkit/hashing` matches the published test vectors.**
  We assert against both vectors from `/world-id/idkit/signatures` in
  `apps/web/lib/verify/verify.test.ts` — `hashSignal('')` and `hashSignal('test_signal')`
  both match to the byte. Publishing test vectors for a hash-to-field is exactly right and
  more SDKs should do it.
- **The verify endpoint is keyless.** `POST /api/v4/verify/{rp_id}` needs no API key, which
  means a backend can verify without holding a Portal credential. Good design.

## What fought us

### 1. `rp_not_active` — no way to see registration state without a team API key

The first real probe against the app, minutes after enabling World ID 4.0 in the Portal:

```
$ curl -s -X POST https://developer.world.org/api/v4/verify/$WORLD_APP_ID \
    -H 'content-type: application/json' -d '{"protocol_version":"4.0", ...}'
{"code":"rp_not_active","detail":"RP registration is not active.","attribute":null,"app_id":"app_98ed…"}
```

The docs' gotcha table covers the symptom and points at
`get_world_id_registration_status` — but that is a **Developer Portal MCP tool**, and the
MCP needs a team API key (`Authorization: Bearer api_<base64(id:secret)>`). There is no
public, unauthenticated way to ask "is my RP registered yet, and in which environment?"

**What would have helped:** `rp_not_active` should carry the current state and an ETA
(`"status":"pending"`), or `/api/v1/precheck/{app_id}` should include registration status.
Right now the only options are "poll blind" or "wire up the MCP with a team key."

### 2. `precheck` will not answer anything until an action exists

We wanted the app's config (specifically `enable_face_check`, which the SKILL tells you to
check before implementing a Selfie Check flow). Every request shape we tried returns the
same thing:

```
$ curl -s -X POST https://developer.world.org/api/v1/precheck/$WORLD_APP_ID \
    -H 'content-type: application/json' -d '{"action":"planbound-approve-plan"}'
{"code":"required","detail":"No action found for this app.","attribute":"action","app_id":"app_98ed…"}
```

Same for `{}`, `{"action":""}`, and `{"action":null}`. So the documented way to check an
**app-level** capability requires an **action-level** resource to already exist. Chicken and
egg: the SKILL says confirm Face Check access *before* implementing, but you cannot confirm
it until you have created the action you are about to implement against.

**What would have helped:** let `precheck` answer with app-level fields when no action is
given, or document that the action must exist first.

### 3. The Managed flow gives you `app_id` and a signer key — `rp_id` is a third thing

`rp_id` is required in `rp_context` for every proof request, and is the path segment of the
verify endpoint. It is not derivable from `app_id` and there is no public lookup. Worth
saying loudly in the Managed setup screen, because a `.env` with app id + signer key looks
complete and is not.

The verify endpoint does accept `app_id` for backward compatibility, which makes the gap
easy to half-miss: verification appears configurable while the *request* still cannot be signed.

### 4. Selfie Check is preview-gated, and the type definition is where you find that out

The spec's step-up story is Selfie Check. The SDK's own JSDoc:

```ts
interface SelfieCheckLegacyPreset {
    /** This preset only returns World ID 3.0 proofs. Use it for compatibility with older IDKit versions. */
    /** Preview: Selfie Check is currently in preview. Contact us if you need it enabled. */
    type: "SelfieCheckLegacy";
    signal?: string;
}
```

Two things a reader has to join up themselves: it is **preview and app-gated**, and it
returns **v3 proofs only** — so `allow_legacy_proofs: true` is mandatory when you use it,
and you inherit v3 nullifier tracking alongside v4. Neither is on the credential page at
`/world-id/credentials/11`, which reads like a generally-available product.

**Consequence for us:** we made the preset an env var (`WORLD_PRESET`) rather than a
hardcoded choice, defaulting to `proofOfHuman`, which works on the simulator today. Selfie
Check is one env change away if the app gets enabled.

### 5. Simulator vs. Sandbox — two testing stories, and the docs are mid-migration

- `/world-id/idkit/integrate` says: use the **simulator** at `simulator.worldcoin.org` with
  `environment: "staging"`.
- `/world-id/sandbox/*` describes **Sandbox**, a newer production-like environment with its
  own TestFlight builds of the World ID app, driven by `environment: "sandbox"`.
- The verify API's OpenAPI schema still enumerates `environment` as `production | staging`
  only — no `sandbox` — while `IDKitRequestConfig.environment` in the SDK accepts all three.

Both simulator hosts answer 200 (`simulator.worldcoin.org` and `simulator.orb.engineer`).
We went with `staging` + simulator because that is the path the verify API documents.

**What would have helped:** one page saying which of simulator/sandbox is the recommended
path as of today, and whether `sandbox` proofs verify through the same v4 endpoint.

### 6. The simulator calls a staging v4 request a "production request"

The most concrete blocker of the session, reproduced twice on both simulator hosts with
freshly-minted connect URLs.

The widget renders correctly in staging — it shows its own "Testing in staging? Use the
simulator" affordance, and the connect URL it generates points at `staging.world.org`:

```
https://simulator.worldcoin.org/?connect_url=https%3A%2F%2Fstaging.world.org%2Fverify%3Ft%3Dwld%26i%3D…
```

Following that link, the simulator answers:

> **Production request detected**
> This simulator only accepts staging requests.
> Set `environment: "staging"` in your request payload.
> Update the request and try again.

`environment: "staging"` **is** set — it is what produced the staging bridge host and the
simulator link in the first place. Same result on `simulator.worldcoin.org` and
`simulator.orb.engineer` (they appear to be the same app; both carry the banner *"This
simulator will change with the adoption of World ID 4.0"*).

Screenshot: [`img/world-simulator-production-request-detected.png`](img/world-simulator-production-request-detected.png).

**Two candidate causes, and we could not isolate which:**

1. The simulator is 3.x-era (its own banner says so) and reads `environment` from a
   v3-shaped payload, so a v4 request looks like it has none and defaults to production.
2. Our `rp_id` was a placeholder for this run, because the app's RP registration is still
   `rp_not_active` (§1) — a malformed RP context might be reported this way.

Distinguishing the two needs an active RP, which is the thing we are blocked on. Recorded
as unresolved rather than guessed.

**What would have helped:** an error that names what it actually parsed
(`"expected environment field, got protocol_version 4.0"`), or a simulator build that
states plainly whether it supports v4 requests yet.

### 7. `agentkit-cli register` cannot be driven headlessly

`npx @worldcoin/agentkit-cli@0.2.0 status <address>` is well-behaved and useful:

```
agent: 0x2eA363b5ACAA8b6b86Bd156B2336c21EbBf5073F
registered: false
humanId: null
contract: 0xA23aB2712eA7BBa896930544C7d6636a96b944dA
network: "eip155:480"
```

`register` blocks indefinitely with no output when stdin is not a TTY — including with
`--manual --format json`, which reads like it should print call data and exit. We stopped
it at 150s twice rather than burn time; registration needs a human with World App, which is
the documented and correct design. Worth a one-line "requires an interactive terminal" in
`--help`, and `--manual` genuinely printing call data without a proof would let a CI or
agent context prepare the transaction for a human to sign later.

Also: `@worldcoin/agentkit-cli@0.2.0` pulls in `@worldcoin/idkit-core@2.1.0`, which npm
flags as deprecated ("Old-versions moved to new ones") — a v2 dependency inside the
weekend's flagship v4 tooling.

---

## What we verified end-to-end, and what we did not

Verified in a browser on 2026-07-25, dev server on port 3002:

- **`HUMAN_VERIFIER` unset / `none`** — the approval page is byte-identical to before this
  task. No step-up block, approve button live. This is the shipping default.
- **`HUMAN_VERIFIER=world`, incomplete config** — the page fails closed and names the gap:
  *"Step-up verification is required for this ceiling but is not configured correctly, so
  nothing can be funded from this page. World verifier selected but WORLD_RP_ID is not
  set…"*. Approve disabled; reject still available.
- **`HUMAN_VERIFIER=world`, $50 ceiling against a $5 threshold** — the step-up block renders
  and gates the approve button:
  [`img/world-step-up-block.png`](img/world-step-up-block.png).
- **IDKit widget opens against staging** — server-minted RP signature, QR code, and the
  simulator affordance: [`img/world-idkit-staging-qr.png`](img/world-idkit-staging-qr.png).
- **24 unit tests** covering selection, threshold, challenge signing, every verify refusal
  path, ticket scoping/expiry, and both published `hashSignal` vectors.

**Not verified: a real proof completing end-to-end.** Blocked on `rp_not_active` (§1) plus
the simulator's "production request detected" (§6), and on the app having no action created
yet in the staging environment (§2). Two Portal values are still needed before this can be
claimed as working: `WORLD_RP_ID`, and an action named `planbound-approve-plan` created
with `environment: staging`.

## Design consequences for PlanBound

These are ours, not World's, but they came out of the above:

- **`none` stays the default verifier.** Everything World-specific lives behind
  `HUMAN_VERIFIER=world`, and an unset env gives a working product. This is per spec §5
  ("World therefore integrates on the go"), and the docs' own environment-mismatch failure
  mode — a staging action producing zero proofs and looking like a frontend bug — is a good
  argument for never making a provider load-bearing at the default.
- **Plan binding does not rest on the credential.** World's v4 uniqueness example returns
  `signal_hash: "0x0"`, so we cannot assume the signal comes back. We check it when it is
  echoed (and refuse a mismatch), report `signalBound: false` when it is not, and bind the
  plan server-side with an HMAC ticket keyed by the plan's approval key
  (`apps/web/lib/verify/ticket.ts`).
- **Nullifiers are not persisted.** The docs are right that `UNIQUE (nullifier, action)` is
  the only anti-replay mechanism, and we do not have it: `supabase/migrations/` is a frozen
  contract for this task. Our exposure is narrower than the reward-claim case the docs
  worry about — a plan is single-use and moves out of `pending_approval` on the first
  decision, and the ticket is plan-scoped and expires in ten minutes — but it is a real gap
  and it needs a migration before this is a uniqueness claim rather than a liveness one.
- **AgentBook registration is a human's five minutes, not an agent's.** `register` needs a
  TTY and a World App scan by design. The agent wallet
  `0x2eA363b5ACAA8b6b86Bd156B2336c21EbBf5073F` currently reads `registered: false` against
  AgentBook `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` on `eip155:480`.
