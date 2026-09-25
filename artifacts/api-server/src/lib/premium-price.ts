// Stripe test and live Prices are separate objects, even for the same plan.
// The owner selected this specific live Price for the £99/month Premium plan.
const LIVE_PREMIUM_PRICE_ID = "price_1UE8sKGeEn25QPrrBWsjoZSy";

export function stripeKeyLivemode(secretKey: string): boolean {
  if (/^(sk|rk)_live_/.test(secretKey)) return true;
  if (/^(sk|rk)_test_/.test(secretKey)) return false;
  throw new Error("Stripe key mode could not be determined.");
}

export function getPremiumPriceId(livemode: boolean): string {
  const priceId = livemode
    ? LIVE_PREMIUM_PRICE_ID
    : process.env.STRIPE_PREMIUM_PRICE_ID;
  if (!priceId || !/^price_[A-Za-z0-9]+$/.test(priceId)) {
    throw new Error("STRIPE_PREMIUM_PRICE_ID is not configured.");
  }
  return priceId;
}