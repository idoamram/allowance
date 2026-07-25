# Addon Middleman v1

> Status: proposal  
> Relationship to v1: optional cross-chain purchasing layer; not required for the core Allowance demo.

## Idea

Allowance becomes a payment middleman between:

- A buyer whose funds and spending controls live on Hedera.
- A vendor that accepts x402 payments only on Base.

The buyer does not need a Base wallet, and the vendor does not need to support Hedera.

The middleman is a **solver**: it pays the vendor from its own Base liquidity, proves that the service was delivered, and is reimbursed from the buyer’s locked Hedera funds plus a fee.

> This is not a direct transfer of the same HBAR from Hedera to Base. It is coordinated settlement using liquidity on both networks.

## Problem

Allowance agents may discover useful x402 services on Base, while the company’s treasury and spending rules live on Hedera.

The obvious options are poor:

- Require every buyer to create and fund a Base wallet.
- Require every Base vendor to add Hedera.
- Operate one central Allowance wallet that holds everyone’s money.
- Build a full token bridge during the hackathon.

The solver model keeps the buyer on Hedera and the vendor on Base.

## Participants

### Buyer

A company or user with an Allowance account funded on Hedera.

### Agent

Finds a service, requests a quote and prepares a purchase plan within the buyer’s limits.

### Solver

Runs the cross-chain payment service. For the hackathon, Allowance operates one solver with a small Base testnet balance.

### Vendor

An existing x402 API that accepts payment on Base. The vendor does not integrate with Allowance or create a Hedera account.

## Payment flow

1. The agent finds a Base-only x402 service.
2. The vendor returns `402 Payment Required` with its Base price.
3. The solver returns a quote containing:
   - Vendor price.
   - Solver fee.
   - Hedera amount to lock.
   - Quote expiry.
4. The user approves the plan.
5. The buyer locks the quoted amount in a Hedera escrow or controlled vault.
6. The solver verifies that the funds are locked.
7. The solver pays the vendor from its own Base wallet.
8. The vendor returns the purchased result.
9. The solver returns the result and Base payment proof to Allowance.
10. Allowance verifies the expected response and proof.
11. The Hedera contract releases the locked funds and fee to the solver.
12. Allowance records the complete purchase trail.

If the solver never pays, the request expires and the buyer recovers the locked funds.

## What the buyer experiences

The buyer asks:

> Find and purchase the best API for this task. Spend no more than $5.

Allowance shows one understandable plan:

- Selected service and reason.
- Vendor price.
- Solver fee.
- Total Hedera amount.
- Expected result.
- Expiration time.

After approval, the buyer sees:

- Hedera lock transaction.
- Base vendor payment.
- Delivered result.
- Solver settlement.
- Final total and audit trail.

The buyer never manages a Base wallet.

## What we would build

### Buyer and agent layer

- Claude/Codex Skill or MCP server.
- Service discovery and x402 quote reader.
- Allowance policy and approval flow.
- Purchase status and receipt UI.

### Hedera layer

- Testnet escrow or single-use purchase vault.
- Lock, release, refund and expiry operations.
- Hedera SDK integration.
- HCS audit events for request, approval, fulfillment and settlement.

### Solver layer

- TypeScript/Node.js solver service.
- Small Base Sepolia wallet funded only for the demo.
- Base x402 payment client.
- Quote engine with a fixed, visible solver fee.
- Fulfillment verifier.
- Idempotency protection to prevent duplicate payments.

### Vendor layer

- One real or controlled x402 API on Base Sepolia.
- Deterministic response that can be verified during the demo.
- No Hedera or Allowance integration.

### Proposed application stack

- TypeScript.
- Next.js for the dashboard.
- Node.js for the solver.
- Hedera JavaScript SDK.
- Solidity only where a Hedera EVM escrow contract is necessary.
- x402 client packages for reading and paying Base payment requirements.
- PostgreSQL or SQLite for off-chain request state.
- Docker for a repeatable demo environment.

Exact package choices should be verified against the current sponsor documentation before implementation.

## Verification model

Payment proof is easier to verify than service quality.

For the MVP, the purchase is successful only when:

1. The Base payment matches the quoted vendor, asset and amount.
2. The vendor returns the expected response format.
3. The response contains a request identifier tied to the purchase.
4. The result hash matches the fulfillment record.

This proves the demo flow without claiming that the system can judge every possible API result.

## Trust model

The buyer does not trust the solver with unlimited funds:

- Each purchase has a fixed maximum.
- Funds are locked for one request only.
- The solver is paid only after fulfillment.
- The buyer can recover funds after expiry.
- Duplicate settlement is rejected.
- Every step has a visible receipt.

The solver still takes temporary liquidity risk because it pays Base first. A production version would require stronger verification, dispute handling, pricing and risk controls.

## Hackathon MVP

The minimum demo should support:

- One buyer on Hedera Testnet.
- One Allowance agent.
- One Allowance-operated solver.
- One Base Sepolia x402 vendor.
- One stable payment asset on each side, if supported by the selected testnet flow.
- One successful purchase.
- One expired or failed purchase that refunds the buyer.
- A UI showing both network transactions and the delivered result.

The MVP should not attempt:

- A permissionless solver marketplace.
- Mainnet funds.
- Automatic liquidity rebalancing.
- Arbitrary vendor-quality verification.
- Multiple destination chains.
- A general-purpose token bridge.

## Demo story

A company’s research agent needs a paid data result from an x402 API on Base.

The company keeps its treasury and agent limits on Hedera. The agent finds the service and shows a complete price, including the solver fee. After one approval, the buyer’s funds are locked on Hedera. The Allowance solver pays the Base vendor, returns the data, proves the payment and fulfillment, and receives the locked Hedera funds. The company gets the service without opening or funding a Base wallet.

## Relationship to the core product

Allowance v1 remains responsible for:

- Understanding the task.
- Building a priced plan.
- Enforcing a spending limit.
- Getting human approval.
- Recording the outcome.

Addon Middleman v1 changes only the execution path when the selected vendor is on a different network.

If this addon is not ready, Allowance can still demo its normal Hedera-native purchase flow.

## Strengths

- Keeps Hedera central to buyer funding and control.
- Gives buyers access to existing Base vendors.
- Requires no change from the vendor.
- Removes the buyer’s need for a Base wallet.
- Is more original than adding another accepted network to a vendor.
- Extends the existing Allowance plan and approval experience.

## Risks

- The solver needs liquidity on Base.
- The solver may pay before reimbursement is guaranteed.
- Cross-network verification is technically difficult.
- Service delivery can be subjective.
- Exchange-rate movement can make a quote unprofitable.
- A production solver may face custody, compliance and operational requirements.
- The full flow is more difficult to demo reliably than a single-network payment.

## Open questions

- Should the buyer lock HBAR, Hedera USDC or another supported asset?
- What exact proof releases solver payment?
- Can the escrow verify the proof directly, or is an attestation service required?
- Who pays transaction fees on each network?
- How long should a quote remain valid?
- How does the solver price exchange-rate and failure risk?
- What happens when payment succeeds but the vendor response is unusable?
- Which Base x402 vendor is reliable enough for the live demo?

## Success criteria

The addon is validated for the hackathon if:

1. A buyer funds and approves one purchase entirely from Hedera.
2. The buyer never creates or funds a Base wallet.
3. The vendor changes nothing and receives its Base x402 payment.
4. The requested result is returned to the agent.
5. The solver receives the agreed Hedera reimbursement and fee.
6. A failed request returns the locked funds.
7. Both network actions are visible in one audit trail.
