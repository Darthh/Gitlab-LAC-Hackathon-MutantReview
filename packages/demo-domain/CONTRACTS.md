# Checkout contracts

All money uses integer cents; supported inputs are nonnegative integers.

**SHIPPING-001:** Orders with a subtotal of at least $100 (10,000 cents) receive
free shipping. Smaller orders pay $5 (500 cents) shipping.

**DISCOUNT-001:** Orders with a subtotal of at least $200 (20,000 cents) receive
a $10 (1,000 cent) loyalty discount. Smaller orders receive no discount.

The initial tests deliberately omit the exact thresholds. They are the original
hackathon demonstration fixture, not a complete production test suite. The local
proof runner tests proposed repairs in a temporary sandbox; it does not apply
them to these files or claim human or GitLab Duo approval.
