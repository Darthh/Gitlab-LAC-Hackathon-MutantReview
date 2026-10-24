/** CONTRACT DISCOUNT-001: Orders of at least 20,000 cents receive a 1,000-cent
 * loyalty discount. Smaller orders receive no discount. Inputs are integer cents. */
export function loyaltyDiscount(subtotalCents: number): number {
  return subtotalCents >= 20_000 ? 1_000 : 0;
}
