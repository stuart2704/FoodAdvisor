import Stripe from "stripe";
import {
  analyticsEventsTable,
  db,
  restaurantsTable,
  stripeProcessedEventsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { assertPublicHttpsUrl } from "../lib/public-url";
import { validateToken } from "./portalTokenService";
import { stripeRequest } from "./stripeClient";

function premiumPriceId(): string {
  const value = process.env.STRIPE_PREMIUM_PRICE_ID;
  if (!value || !/^price_[A-Za-z0-9]+$/.test(value)) {
    throw new Error("STRIPE_PREMIUM_PRICE_ID is not configured.");
  }
  return value;
}

export async function createCheckoutSession(
  portalToken: string,
): Promise<string> {
  const placeId = await validateToken(portalToken);
  if (!placeId) throw new Error("Invalid or expired portal login.");
  const [restaurant] = await db
    .select({
      placeId: restaurantsTable.placeId,
      name: restaurantsTable.name,
      email: restaurantsTable.claimEmail,
      customerId: restaurantsTable.stripeCustomerId,
      subscriptionId: restaurantsTable.stripeSubscriptionId,
      premium: restaurantsTable.premium,
    })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  if (!restaurant?.email) throw new Error("A claimed business email is required.");
  if (restaurant.premium || restaurant.subscriptionId) {
    throw new Error("This restaurant already has a subscription.");
  }

  let customerId = restaurant.customerId;
  if (!customerId) {
    const customerForm = new URLSearchParams({
      email: restaurant.email,
      name: restaurant.name,
      "metadata[restaurantId]": restaurant.placeId,
    });
    const customer = await stripeRequest<Stripe.Customer>("/v1/customers", {
      method: "POST",
      form: customerForm,
      idempotencyKey: `restaurant-customer-${restaurant.placeId}`,
    });
    customerId = customer.id;
    await db
      .update(restaurantsTable)
      .set({ stripeCustomerId: customerId })
      .where(eq(restaurantsTable.placeId, restaurant.placeId));
  }

  const publicUrl = await assertPublicHttpsUrl(process.env.PUBLIC_APP_URL, {
    canonical: true,
  });
  const encodedToken = encodeURIComponent(portalToken);
  const checkoutForm = new URLSearchParams({
    mode: "subscription",
    customer: customerId,
    "line_items[0][price]": premiumPriceId(),
    "line_items[0][quantity]": "1",
    success_url: `${publicUrl}/portal/${encodedToken}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${publicUrl}/portal/${encodedToken}/upgrade/cancel`,
    "metadata[restaurantId]": restaurant.placeId,
    "subscription_data[metadata][restaurantId]": restaurant.placeId,
  });
  const session = await stripeRequest<Stripe.Checkout.Session>(
    "/v1/checkout/sessions",
    { method: "POST", form: checkoutForm },
  );
  if (!session.url) throw new Error("Stripe checkout URL was not returned.");
  return session.url;
}

async function applyVerifiedEvent(event: Stripe.Event): Promise<void> {
  await db.transaction(async (tx) => {
    const [reserved] = await tx
      .insert(stripeProcessedEventsTable)
      .values({ eventId: event.id, eventType: event.type })
      .onConflictDoNothing()
      .returning({ eventId: stripeProcessedEventsTable.eventId });
    if (!reserved) return;

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const restaurantId = session.metadata?.restaurantId;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      const customerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
      if (
        !restaurantId ||
        !subscriptionId ||
        !customerId ||
        session.payment_status !== "paid"
      ) {
        throw new Error("Stripe checkout metadata was incomplete.");
      }
      const [existing] = await tx
        .select({
          placeId: restaurantsTable.placeId,
          premium: restaurantsTable.premium,
        })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.placeId, restaurantId))
        .limit(1);
      if (!existing) throw new Error("Stripe restaurant mapping was missing.");
      const [updated] = await tx
        .update(restaurantsTable)
        .set({
          premium: true,
          premiumSince: new Date(),
          premiumCancelledAt: null,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
        })
        .where(eq(restaurantsTable.placeId, restaurantId))
        .returning({ placeId: restaurantsTable.placeId });
      if (!updated) throw new Error("Stripe restaurant mapping was missing.");
      if (!existing.premium) {
        await tx.insert(analyticsEventsTable).values({
          restaurantId,
          type: "premium_conversion",
          metadata: {},
        });
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const restaurantId = subscription.metadata.restaurantId;
      if (!restaurantId) {
        throw new Error("Stripe subscription metadata was incomplete.");
      }
      const [updated] = await tx
        .update(restaurantsTable)
        .set({
          premium: false,
          premiumCancelledAt: new Date(),
          stripeSubscriptionId: null,
        })
        .where(eq(restaurantsTable.placeId, restaurantId))
        .returning({ placeId: restaurantsTable.placeId });
      if (!updated) throw new Error("Stripe restaurant mapping was missing.");
    }
  });
}

export async function handleWebhook(
  payload: Buffer,
  _signature: string,
): Promise<void> {
  if (!Buffer.isBuffer(payload)) throw new Error("Stripe payload must be raw.");
  let hintedEvent: unknown;
  try {
    hintedEvent = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new Error("Stripe event body was invalid.");
  }
  const eventId =
    typeof hintedEvent === "object" &&
    hintedEvent !== null &&
    "id" in hintedEvent &&
    typeof hintedEvent.id === "string" &&
    /^evt_[A-Za-z0-9]{8,128}$/.test(hintedEvent.id)
      ? hintedEvent.id
      : null;
  if (!eventId) throw new Error("Stripe event ID was invalid.");
  const event = await stripeRequest<Stripe.Event>(
    `/v1/events/${encodeURIComponent(eventId)}`,
  );
  await applyVerifiedEvent(event);
}

export default { createCheckoutSession, handleWebhook };