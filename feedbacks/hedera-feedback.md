# Hedera — developer feedback

**From:** PlanBound, ETHGlobal Lisbon 2026 — [planbound.xyz](https://planbound.xyz)

**What we built with it:** an agent-spending product where a Hedera account *is* the spending
cap. An approval mints a single-use account keyed
`1-of-[ 2-of-2(agent, policy), treasury ]`, funds it to exactly the approved ceiling, and
schedules its own refund at expiry. The account that holds the limit is the account that pays
the seller, so there is no service in the middle that could fail open.

**Versions:** `@hiero-ledger/sdk` 2.86 · `@x402/hedera` 2.19 · Blocky402 hosted testnet
facilitator.
**Context:** first time using Hedera. Everything below was hit in one night, so it is a fair
sample of what a newcomer meets. Written the same night — the error strings are exact.

**Verdict up front:** the primitives did exactly what we needed, and the x402 loop worked on the
first complete run. The friction was almost entirely in *discovering* semantics that are easy to
get wrong and that fail with misleading errors. Two of the findings below made a security test
pass for the wrong reason, which is the most expensive kind of surprise.

---

## 1. The fee payer's signature counts toward the paid-from account's key threshold

**Severity: high — this made a security test pass for the wrong reason.**

Our envelope key is `1-of-[ 2-of-2(agent, policy), treasury ]`. The whole product claim is
that the agent cannot spend alone. We wrote the obvious test:

```ts
// treasury is the client operator, i.e. the fee payer
const solo = await new TransferTransaction()
  .addHbarTransfer(envelope, new Hbar(-1))
  .addHbarTransfer(treasuryId, new Hbar(1))
  .freezeWith(client)          // client operator = treasury
await (await solo.sign(agentKey)).execute(client)   // expected INVALID_SIGNATURE
```

It **succeeded**. Not because the agent's signature was accepted, but because the
*treasury's fee-payer signature* independently satisfied the outer `1-of`. The dual-control
guarantee was never exercised, and a naive reading of the green test would have shipped a
product whose central claim was untested.

The fix is to pay the fee from an account outside the envelope key:

```ts
const relayerClient = Client.forTestnet().setOperator(relayerId, relayerKey)
const tx = await new TransferTransaction()… .freezeWith(relayerClient)
await (await (await tx.sign(agentKey)).sign(policyKey)).execute(relayerClient)  // SUCCESS
// agent alone, same payer → INVALID_SIGNATURE, as intended
```

**What would have helped:** one sentence in the KeyList / threshold-key documentation
saying that the fee payer signs the transaction and that signature is evaluated against
every account whose balance decreases. It is obvious *afterwards* and invisible *before*.
A worked "dual-control account" example that uses a third-party payer would prevent an
entire class of silently-wrong security tests.

**Bonus:** this turned out to be a *feature* for us — it means the treasury reclaim path
needs no extra signature, and it means an x402 facilitator (an external fee payer) is
exactly the right topology for letting a bounded account pay a seller. But we found that
by accident, not by reading.

## 2. Raw-hex private keys are algorithm-ambiguous, and the failure looks like a permissions bug

**Severity: high — cost us ~25 minutes and would cost a newcomer much more.**

A 64-char hex string parses successfully as **both** ED25519 and ECDSA:

```ts
PrivateKey.fromStringECDSA(hex)     // ok
PrivateKey.fromStringED25519(hex)   // also ok — different key!
```

Pick wrong and nothing complains until the network rejects the transaction with
`INVALID_SIGNATURE` (status 7) at precheck. That error reads as "you are not allowed to do
this", so the natural debugging path is to go audit key structures and permissions — which
is the wrong tree entirely. There is no local way to notice.

The reliable disambiguation is the mirror node, which publishes the account's key type and
public key:

```ts
const info = await (await fetch(`${MIRROR}/api/v1/accounts/${id}`)).json()
info.key._type   // 'ECDSA_SECP256K1' | 'ED25519'
info.key.key     // public key — verify the parsed private key derives THIS
```

### 2b. `fromStringDer()` silently accepts raw hex and returns a DIFFERENT key

**This is the sharper version of 2, found the hard way several hours later. Severity: high.**

We wrote what looks like a safe fallback chain — try the most specific parser first:

```ts
for (const parse of [
  () => PrivateKey.fromStringDer(s),      // ← for a raw 64-hex string this does NOT throw
  () => PrivateKey.fromStringECDSA(s),
  () => PrivateKey.fromStringED25519(s),
]) { try { return parse() } catch { /* next */ } }
```

`fromStringDer()` on a raw 64-hex string **succeeds** and returns an **ED25519** key, so the
first branch always wins — and wins wrongly for every secp256k1 key. Measured on one key:

```
stored (what the account was built with)  302d300706052b8104000a0322000200d310e4eb…  (ECDSA)
fromStringDer(rawHex)                     302a300506032b6570032100a097104ec517111c…  (ED25519!)
fromStringECDSA(rawHex)                   302d300706052b8104000a0322000200d310e4eb…  ← the real one
```

The consequence: we created a Hedera account whose key list contained a public key derived
the wrong way, then signed with the right one, and got `INVALID_SIGNATURE` at **settlement**
— three network hops and one facilitator away from the actual mistake. We had already
documented finding 2 and written a mirror-node verifier for the *operator* key; it still bit
us on a key that has no account to check against.

**Asks:**
- **`fromStringDer` should reject input without a DER prefix.** A parser named for an
  encoding accepting a different encoding, and silently producing a valid-but-wrong key, is
  the most expensive kind of lenient. Throwing here removes the whole class of bug.
- Failing that, document loudly that DER-vs-raw must be selected by inspection, not by
  try/catch. Our fix selects by prefix (`/^30[0-9a-f]{2}/` and length > 64) and then
  verifies the derived public key against an expected value whenever the caller has one.

**What would have helped:**
- `PrivateKey.forAccount(accountId, keyString, network)` in the SDK — resolve and verify in
  one call. Every application that loads a key from config needs this and every one of them
  is currently reimplementing it.
- Failing that: make `fromString*` mismatches detectable, or have the portal export keys in
  DER by default (DER is unambiguous — `302e…` vs `3030…` — and worked first try).
- A note in the `INVALID_SIGNATURE` docs saying "if you loaded a raw-hex key, suspect the
  algorithm before you suspect the permissions."

We also hit the deprecation warning below on *every* run, including for DER input:
```
WARNING: Consider using fromStringECDSA() or fromStringED25519() on a HEX-encoded string
and fromStringDer() on a HEX-encoded string with DER prefix instead.
```
It fires from inside code paths we didn't choose, so it reads as noise rather than guidance.

## 3. Scheduled transactions: the constraints are right, but the shape of the gap wasn't obvious

We wanted "an abandoned plan refunds itself with no keeper running". `ScheduleCreate` +
`setExpirationTime` + `setWaitForExpiry(true)` does this beautifully — our envelope went
3.5 ℏ → 0.5 ℏ at the scheduled instant with nothing running, confirmed on consensus and on
the mirror node. Genuinely delightful; it's the reason we could promise a keeperless refund
at all.

What took reading to establish:
- **Amounts are fixed at creation.** So this covers "nobody ever spent anything" but not
  "spent some, refund the remainder" — a partial remainder still needs an active sweep.
  That's a reasonable design; it just deserves to be stated in the *use-case* framing
  ("scheduled transactions are for known amounts") rather than inferred from the fact that
  you must supply a transaction body.
- **`CryptoDelete` is not schedulable**, so "delete the account and return everything"
  isn't available as the self-cleanup primitive.
- **A failed scheduled transaction does not retry.** Worth a bold line: it changes whether
  you can rely on this as your only refund path.

**What would have helped:** a short "what scheduled transactions are and aren't for" section
with these three constraints together. We derived them one at a time, and the shape of the
solution changed twice as a result.

## 4. `@x402/hedera` — worked, and the design is right

Positive report: `ExactHederaScheme` + `createClientHederaSigner` + Blocky402's hosted
testnet facilitator worked **on the first complete run**. Seller 402 → buyer partial-sign →
facilitator verify + settle → merchant credited 0.5 ℏ, mirror-verified.

The partially-signed-transfer design is exactly what our product needs: the payer is the
bounded account, the facilitator adds the fee-payer signature, and (per finding #1) that
external signature is what completes the threshold. A bounded account can pay a stranger
without the treasury ever signing. That's a genuinely strong primitive and we don't think
it's advertised as such.

Two rough edges:

**4a. Duplicate SDK instance breaks nominal types.** `@x402/hedera` resolves its own copy of
`@hiero-ledger/sdk` (2.85 line, react-native peer variant), so a `PrivateKey` built from the
app's 2.86 instance is not assignable to `createClientHederaSigner`:

```
Argument of type 'PrivateKey' is not assignable to parameter of type 'PrivateKey'.
  Types have separate declarations of a private property '_key'.
```

Same class at runtime, different declaration identity. We cast. A peer dependency on the
host application's SDK would remove this for everyone.

**4b. `@hiero-ledger/proto` peer warning on every install:**
`unmet peer protobufjs@8.0.1: found 8.6.6` (and `debug@4.4.1` vs `4.4.3`). Harmless in
practice, but it's the first thing a new developer sees and it makes the stack look unstable.

## 5. Smaller notes

- **Amount units.** x402 Hedera quotes arrive in **tinybars** while EVM rails quote 6dp
  USDC. Our first pass through a shared parser mislabelled 0.5 ℏ as `$0.50`. Not the SDK's
  fault, but a note in the x402-Hedera docs — "amount is tinybars, asset `0.0.0` is HBAR" —
  would land exactly where it's needed.
- **Settlement identity.** The settle receipt's `transaction` id belongs to the
  *facilitator's* fee payer (`0.0.7162784@…`), not to the payer account. Anything
  reconciling receipts to payers needs `payer` as well, and we only learned that by reading
  a live response.
- **`setKeyWithoutAlias` vs `setKeyWithAlias`.** The naming didn't make it obvious which one
  a plain multi-key account wants. We guessed right; the ECDSA-alias implications are worth
  one clarifying sentence.
- **Docs vs blog.** hedera.com's x402 blog post names Blocky402 but doesn't link an
  integration guide; we found `api.testnet.blocky402.com/supported` by search and then
  confirmed the shape by calling it. A "start here for x402 on Hedera" page would have
  saved half an hour.

---

## What we'd most want fixed, in order

1. Document that the **fee payer's signature counts toward the threshold** (finding #1). It
   is a correctness trap for anyone building multi-sig spending controls.
2. Ship **`PrivateKey.forAccount(...)`** or equivalent (finding #2), and stop
   `INVALID_SIGNATURE` from being the first symptom of a parsing mistake.
3. Make **`@x402/hedera` peer-depend** on the host SDK (finding 4a).
4. A single **"scheduled transactions: what they're for"** page with the three constraints
   in one place (finding #3).
