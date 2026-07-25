# 002 — Vendor onboarding

> Status: proposal  
> Relationship to v1: optional supply-side expansion; not required for the core hackathon demo.

## Idea

Allowance currently helps agents plan, approve and pay for services.

Vendor onboarding adds the other side: helping API providers make their services discoverable and purchasable by agents through x402 on Hedera.

The goal is:

> Add Hedera payments to an API without requiring the vendor to understand x402, facilitators or Hedera infrastructure.

## Problem

Hedera technically supports x402 payments, but a vendor still needs to:

- Create and configure a Hedera receiving account.
- Associate the account with USDC when necessary.
- Select or deploy a payment facilitator.
- Add x402 middleware to its API.
- Define endpoint prices and payment assets.
- Publish service information for agent discovery.
- Monitor payments and settlement errors.

This is too much infrastructure for a vendor that only wants to sell access to an API.

Without simple vendor tooling, Allowance agents may have very few Hedera-native services available to purchase.

## Proposed vendor experience

A vendor runs:

```bash
npx allowance-vendor init
```

The setup asks:

1. Which API endpoint should be protected?
2. What does the endpoint provide?
3. What should each request cost?
4. Should it accept HBAR, USDC or both?
5. Which Hedera account should receive payments?

Allowance then:

- Checks that the receiving account exists.
- Checks USDC token association.
- Generates the x402 middleware configuration.
- Connects the API to a compatible facilitator.
- Runs a testnet payment.
- Generates service-discovery metadata.
- Provides a payment and error dashboard.

## Payment flow

1. An agent requests the vendor’s API.
2. The API returns `402 Payment Required`.
3. The response describes the price, asset and receiving account.
4. The agent signs the payment.
5. The facilitator verifies and settles it on Hedera.
6. Payment goes directly to the vendor.
7. The API returns the requested service or data.
8. Allowance records the receipt and outcome.

Allowance should not hold the vendor’s revenue or require a central Allowance wallet.

## Relationship to the core product

This creates two connected product surfaces:

### Buyer side

Agents use Allowance to:

- Build priced plans.
- Request human approval.
- Follow spending limits.
- Purchase services.
- Report results and spending drift.
- Learn which services are effective.

### Vendor side

API providers use Allowance to:

- Add x402 payments.
- Accept HBAR or USDC.
- Publish service descriptions and pricing.
- Test their payment configuration.
- Monitor purchases and settlement failures.

The buyer side remains the hackathon core. Vendor onboarding expands the available market but must not block the main demo.

## Hackathon scope

The minimum vendor demo should show:

- One API protected by Allowance middleware.
- Vendor configuration through a CLI or simple setup screen.
- HBAR or USDC payment on Hedera Testnet.
- Successful delivery after payment.
- Rejection when payment is missing or invalid.
- A visible payment receipt.

For the main demonstration, we can operate the vendor API ourselves. We do not need external vendors to adopt the product during the hackathon.

## Optional additions

If the core payment flow works reliably:

- Support both HBAR and USDC.
- Generate Bazaar or other discovery metadata.
- Publish an MCP-compatible service description.
- Add facilitator health checks.
- Show revenue, calls and settlement errors.
- Offer a self-hosted facilitator deployment template.
- Allow agents to rate service quality after use.

## Risks and open questions

- Is there a reliable hosted Hedera mainnet facilitator?
- Should vendors self-host the facilitator or use a managed provider?
- How should facilitator signing keys be protected?
- Can discovery metadata be published automatically?
- How should refunds and failed service delivery work?
- How much onboarding can realistically be automated during the hackathon?
- Is vendor onboarding valuable enough to become a product surface, or should it remain developer tooling?

## Success criteria

The idea is validated for the hackathon if:

1. A developer can protect an API with minimal configuration.
2. An Allowance agent can discover or receive its payment requirements.
3. The agent pays through Hedera Testnet.
4. The vendor receives payment directly.
5. The agent receives the purchased result.
6. The complete flow is visible in the Allowance audit trail.
