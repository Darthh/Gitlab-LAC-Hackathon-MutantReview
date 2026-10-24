/** CONTRACT SHIPPING-001: Orders of at least 10,000 cents receive free shipping.
 * Smaller orders pay 500 cents. Inputs are nonnegative integer cents. */
export function shippingFee(subtotalCents: number): number {
  if (subtotalCents >= 10_000) return 0;
  return 500;
}
