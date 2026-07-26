// Platform commission.
//
// The model, from docs/product/08-monetisation.md §1:
//
//   creator earns          ₹40,000   (the full advertised rate, always)
//   platform fee 5%        ₹ 2,000   (borne by the brand, on top)
//   brand is charged       ₹42,000
//
// The creator's amount is never reduced. The fee is realised by not
// transferring it — the remainder stays in the platform's Razorpay account —
// which is why there is no second transfer call anywhere in the payout path.
//
// ⚠ GST is not applied here, and it is not optional in the long run. Platform
// commission is a supply of services in India: at 18% a ₹2,000 fee bills as
// ₹2,360 and the brand is charged ₹42,360, not ₹42,000. The doc says confirm
// the treatment with an accountant before implementing, so the rate below is
// deliberately the bare commission. Adding tax means changing this file and
// nothing else.
export const PLATFORM_FEE_RATE = 0.05;

// Rounded independently of the payout rather than derived from an unrounded
// product: the fee is its own line on an invoice, so it has to be a real
// two-decimal amount in its own right.
export function platformFee(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * PLATFORM_FEE_RATE * 100) / 100;
}

// What a payout actually costs the brand, and therefore what it consumes of a
// campaign's funded budget.
//
// Throws rather than returning NaN on a non-numeric amount. The caller compares
// this against a budget, and `committed + NaN > budget` evaluates to false —
// a silent NaN would wave the payout straight through the one check that is
// supposed to stop it.
export function totalChargedToBrand(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    throw new TypeError(`totalChargedToBrand: expected a number, got ${amount}`);
  }
  return Math.round((value + platformFee(value)) * 100) / 100;
}
