import { describe, expect, it } from 'vitest';
import { shippingFee } from './shipping.js';

describe('shipping fee', () => {
  it('charges $5 below the free-shipping threshold', () => {
    expect(shippingFee(9_999)).toBe(500);
  });

  it('ships for free above the threshold', () => {
    expect(shippingFee(10_001)).toBe(0);
  });
});
