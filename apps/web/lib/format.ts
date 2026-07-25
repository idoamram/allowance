/**
 * How money reads to the human. Sub-cent prices are real in this market — the median
 * x402 call is $0.02 — so an amount is never rounded into looking like zero.
 */
export function usd(amount: number): string {
  const digits = amount > 0 && amount < 0.01 ? 4 : 2
  return `$${amount.toFixed(digits)}`
}
