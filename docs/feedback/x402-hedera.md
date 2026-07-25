# SDK feedback — @x402/hedera 2.19.0 + @hiero-ledger/sdk 2.86

Logged while fresh (2026-07-25, spikes S1/S4). Overall: the stack worked end to end on
the first full run — the notes below are the friction on the way there.

- **Duplicate SDK instance breaks nominal types.** `@x402/hedera` resolves its own copy
  of `@hiero-ledger/sdk` (2.85 line, react-native peer variant), so a `PrivateKey`
  created from the app's 2.86 instance is not assignable to
  `createClientHederaSigner(accountId, privateKey)` — same class at runtime, different
  declaration identity. Worked around with a cast; a peer-dependency on the host app's
  SDK would fix it.
- **Raw-hex private keys are algorithm-ambiguous.** A 64-hex string parses as both
  ED25519 and ECDSA; picking wrong fails only at precheck with `INVALID_SIGNATURE`
  (status 7), which reads like a permissions bug, not a parse bug. The mirror node's
  `key._type` disambiguates — an SDK helper doing this (`PrivateKey.forAccount(id, s)`)
  would save every newcomer an hour.
- **The fee payer's signature counts toward the paid-from account's key threshold.**
  Documented nowhere prominent; it silently satisfied our `1-of-[…, treasury]` envelope
  key when the treasury paid the fee, making a security test pass for the wrong reason.
  Worth a loud note in the KeyList docs.
- **`@hiero-ledger/proto` peer warning** (`protobufjs@8.0.1` wanted, 8.6.x found) on
  every install; harmless in practice but noisy.
- Blocky402's hosted testnet facilitator (`api.testnet.blocky402.com`) was keyless and
  worked exactly as `/supported` advertises — `/verify` and `/settle` with
  `{x402Version, paymentPayload, paymentRequirements}`. No friction.
