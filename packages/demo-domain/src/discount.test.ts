import { describe, expect, it } from 'vitest';
import { loyaltyDiscount } from './discount.js';

describe('loyalty discount', () => {
  it('gives no discount below $200', () => {
    expect(loyaltyDiscount(19_999)).toBe(0);
  });
  it('gives $10 above $200', () => {
    expect(loyaltyDiscount(20_001)).toBe(1_000);
  });
});
