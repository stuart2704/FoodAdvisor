import Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient";

const PRODUCT_NAME = "Premium Restaurant Listing";
const LOOKUP_KEY = "the_food_advisor_premium_monthly_gbp";

async function activeProduct(
  stripe: Stripe,
  price: Stripe.Price,
): Promise<boolean> {
  const product =
    typeof price.product === "string"
      ? await stripe.products.retrieve(price.product)
      : price.product;
  return !("deleted" in product && product.deleted) && product.active;
}

async function validPremiumPrice(
  stripe: Stripe,
  price: Stripe.Price,
): Promise<boolean> {
  return (
    price.active &&
    price.currency === "gbp" &&
    price.unit_amount === 9_900 &&
    price.type === "recurring" &&
    price.recurring?.interval === "month" &&
    price.recurring.interval_count === 1 &&
    (await activeProduct(stripe, price))
  );
}

async function findOrCreatePremiumPrice(): Promise<string> {
  const stripe = await getUncachableStripeClient();
  const configuredId = process.env.STRIPE_PREMIUM_PRICE_ID;
  if (configuredId) {
    try {
      const configured = await stripe.prices.retrieve(configuredId);
      if (await validPremiumPrice(stripe, configured)) return configured.id;
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) {
        throw error;
      }
    }
  }

  const matching = await stripe.prices.list({
    active: true,
    currency: "gbp",
    lookup_keys: [LOOKUP_KEY],
    type: "recurring",
    limit: 100,
  });
  for (const price of matching.data) {
    if (await validPremiumPrice(stripe, price)) return price.id;
  }

  const product = await stripe.products.create(
    {
      name: PRODUCT_NAME,
      description:
        "Monthly Premium listing subscription for a verified restaurant.",
      metadata: {
        application: "the-food-advisor",
        plan: "premium",
      },
    },
    { idempotencyKey: "the-food-advisor-premium-product-v1" },
  );
  const price = await stripe.prices.create(
    {
      product: product.id,
      active: true,
      currency: "gbp",
      unit_amount: 9_900,
      recurring: { interval: "month", interval_count: 1 },
      lookup_key: LOOKUP_KEY,
      metadata: {
        application: "the-food-advisor",
        plan: "premium",
      },
    },
    { idempotencyKey: "the-food-advisor-premium-gbp-monthly-v1" },
  );
  return price.id;
}

const priceId = await findOrCreatePremiumPrice();
console.log(priceId);