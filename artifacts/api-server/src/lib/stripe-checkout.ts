import { ReplitConnectors } from "@replit/connectors-sdk";
import { assertPublicHttpsUrl } from "./public-url";

const MONTHLY_PRICE_PENCE = 9_900;

type StripePrice = {
  active?: boolean;
  currency?: string;
  id?: string;
  recurring?: { interval?: string } | null;
  unit_amount?: number | null;
};

type StripeCheckoutSession = { url?: string | null };

async function stripeRequest<T>(
  path: string,
  options?: { method: string; body: URLSearchParams },
): Promise<T> {
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("stripe", path, {
    method: options?.method ?? "GET",
    body: options?.body,
    headers: options
      ? { "Content-Type": "application/x-www-form-urlencoded" }
      : undefined,
  });
  if (!response.ok) {
    throw new Error(`Stripe connector returned HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
}

export async function createMonthlyCheckout(input: {
  placeId: string;
  restaurantName: string;
  email: string;
}): Promise<string> {
  const priceId = process.env.STRIPE_MONTHLY_PRICE_ID;
  if (!priceId) {
    throw new Error(
      "STRIPE_MONTHLY_PRICE_ID must reference the configured £99 GBP monthly price.",
    );
  }
  const publicUrl = await assertPublicHttpsUrl(process.env.PUBLIC_APP_URL, {
    canonical: true,
  });
  const price = await stripeRequest<StripePrice>(
    `/v1/prices/${encodeURIComponent(priceId)}`,
  );
  if (
    price.id !== priceId ||
    price.active !== true ||
    price.currency !== "gbp" ||
    price.unit_amount !== MONTHLY_PRICE_PENCE ||
    price.recurring?.interval !== "month"
  ) {
    throw new Error(
      "STRIPE_MONTHLY_PRICE_ID is not an active £99 GBP monthly recurring price.",
    );
  }

  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("line_items[0][price]", priceId);
  body.set("line_items[0][quantity]", "1");
  body.set("customer_email", input.email);
  body.set("success_url", `${publicUrl.origin}/claim/success?session_id={CHECKOUT_SESSION_ID}`);
  body.set("cancel_url", `${publicUrl.origin}/restaurants/${encodeURIComponent(input.placeId)}`);
  body.set("client_reference_id", input.placeId);
  body.set("metadata[place_id]", input.placeId);
  body.set("metadata[brand]", "The Food Advisor");
  body.set("subscription_data[metadata][place_id]", input.placeId);
  body.set("subscription_data[metadata][restaurant_name]", input.restaurantName);

  const session = await stripeRequest<StripeCheckoutSession>(
    "/v1/checkout/sessions",
    { method: "POST", body },
  );
  if (!session.url?.startsWith("https://checkout.stripe.com/")) {
    throw new Error("Stripe did not return a valid hosted Checkout URL.");
  }
  return session.url;
}