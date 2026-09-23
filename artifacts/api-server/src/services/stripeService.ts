import Stripe from "stripe";
import {
  analyticsEventsTable,
  db,
  restaurantsTable,
  stripeProcessedEventsTable,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { assertPublicHttpsUrl } from "../lib/public-url";
import { validateToken } from "./portalTokenService";
import {
  getPremiumPriceId,
  getStripeSync,
  getUncachableStripeClient,
} from "./stripeClient";

export async function createCheckoutSession(
  portalToken: string,
): Promise<string> {
  const placeId = await validateToken(portalToken);
  if (!placeId) throw new Error("Invalid or expired portal login.");
  const stripe = await getUncachableStripeClient();
  const publicUrl = await assertPublicHttpsUrl(process.env.PUBLIC_APP_URL, {
    canonical: true,
  });
  const encodedToken = encodeURIComponent(portalToken);

  const reservation = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`stripe-checkout:${placeId}`}))`,
    );
    const [restaurant] = await tx
      .select({
        placeId: restaurantsTable.placeId,
        name: restaurantsTable.name,
        email: restaurantsTable.claimEmail,
        customerId: restaurantsTable.stripeCustomerId,
        subscriptionId: restaurantsTable.stripeSubscriptionId,
        checkoutAttemptId: restaurantsTable.stripeCheckoutAttemptId,
        checkoutSessionId: restaurantsTable.stripeCheckoutSessionId,
        premium: restaurantsTable.premium,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, placeId))
      .limit(1);
    if (!restaurant?.email) {
      throw new Error("A claimed business email is required.");
    }
    if (restaurant.premium || restaurant.subscriptionId) {
      throw new Error("This restaurant already has a subscription.");
    }
    const checkoutAttemptId =
      restaurant.checkoutAttemptId ?? crypto.randomUUID();
    if (!restaurant.checkoutAttemptId) {
      await tx
        .update(restaurantsTable)
        .set({ stripeCheckoutAttemptId: checkoutAttemptId })
        .where(eq(restaurantsTable.placeId, restaurant.placeId));
    }
    return { ...restaurant, checkoutAttemptId };
  });

  if (reservation.checkoutSessionId) {
    const existingSession = await stripe.checkout.sessions.retrieve(
      reservation.checkoutSessionId,
    );
    if (
      existingSession.mode !== "subscription" ||
      existingSession.metadata?.restaurantId !== reservation.placeId
    ) {
      throw new Error("Stored Stripe checkout did not match the restaurant.");
    }
    if (existingSession.status === "open" && existingSession.url) {
      return existingSession.url;
    }
    if (existingSession.status === "complete") {
      throw new Error("This restaurant already has a checkout awaiting confirmation.");
    }
    await db
      .update(restaurantsTable)
      .set({
        stripeCheckoutAttemptId: null,
        stripeCheckoutSessionId: null,
      })
      .where(
        and(
          eq(restaurantsTable.placeId, reservation.placeId),
          eq(
            restaurantsTable.stripeCheckoutSessionId,
            reservation.checkoutSessionId,
          ),
          isNull(restaurantsTable.stripeSubscriptionId),
        ),
      );
    return createCheckoutSession(portalToken);
  }

  let customerId = reservation.customerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: reservation.email!,
      name: reservation.name,
      metadata: { restaurantId: reservation.placeId },
    }, {
      idempotencyKey: `restaurant-customer-${reservation.placeId}`,
    });
    customerId = customer.id;
    await db
      .update(restaurantsTable)
      .set({ stripeCustomerId: customerId })
      .where(eq(restaurantsTable.placeId, reservation.placeId));
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: getPremiumPriceId(), quantity: 1 }],
    success_url: `${publicUrl}/portal/${encodedToken}/upgrade?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${publicUrl}/portal/${encodedToken}/upgrade?checkout=cancelled`,
    metadata: { restaurantId: reservation.placeId },
    subscription_data: {
      metadata: { restaurantId: reservation.placeId },
    },
  }, {
    idempotencyKey: `restaurant-checkout-${reservation.checkoutAttemptId}`,
  });
  if (!session.url) throw new Error("Stripe checkout URL was not returned.");
  const [stored] = await db
    .update(restaurantsTable)
    .set({ stripeCheckoutSessionId: session.id })
    .where(
      and(
        eq(restaurantsTable.placeId, reservation.placeId),
        eq(
          restaurantsTable.stripeCheckoutAttemptId,
          reservation.checkoutAttemptId,
        ),
        isNull(restaurantsTable.stripeSubscriptionId),
      ),
    )
    .returning({ placeId: restaurantsTable.placeId });
  if (!stored) {
    throw new Error("The restaurant checkout reservation changed unexpectedly.");
  }
  return session.url;
}

export async function getCheckoutCompletion(
  portalToken: string,
  sessionId: string,
): Promise<{ paid: boolean; premium: boolean }> {
  const placeId = await validateToken(portalToken);
  if (!placeId) throw new Error("Invalid or expired portal login.");
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9]{20,200}$/.test(sessionId)) {
    throw new Error("Invalid checkout session.");
  }

  const stripe = await getUncachableStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.metadata?.restaurantId !== placeId) {
    throw new Error("Checkout session does not belong to this restaurant.");
  }
  const [restaurant] = await db
    .select({ premium: restaurantsTable.premium })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  if (!restaurant) throw new Error("Restaurant not found.");
  return {
    paid:
      session.payment_status === "paid" ||
      session.payment_status === "no_payment_required",
    premium: restaurant.premium,
  };
}

interface PremiumActivation {
  kind: "activate";
  restaurantId: string;
  customerId: string;
  subscriptionId: string;
}

interface PremiumCancellation {
  kind: "cancel";
  restaurantId: string;
  customerId: string;
  subscriptionId: string;
}

interface CheckoutReservationRelease {
  kind: "release";
  restaurantId: string;
  checkoutSessionId: string;
}

type PremiumEventAction =
  | PremiumActivation
  | PremiumCancellation
  | CheckoutReservationRelease;

function idOf(
  value: string | { id: string } | null,
): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function activationFromSubscription(
  subscription: Stripe.Subscription,
): PremiumActivation | null {
  if (
    subscription.status !== "active" &&
    subscription.status !== "trialing"
  ) {
    return null;
  }
  const restaurantId = subscription.metadata.restaurantId;
  const customerId = idOf(subscription.customer);
  const onlyItem = subscription.items.data[0];
  const isExactPremiumPlan =
    subscription.items.data.length === 1 &&
    onlyItem?.price.id === getPremiumPriceId() &&
    onlyItem.quantity === 1;
  if (!restaurantId || !customerId || !isExactPremiumPlan) return null;
  return {
    kind: "activate",
    restaurantId,
    customerId,
    subscriptionId: subscription.id,
  };
}

async function actionFromVerifiedEvent(
  event: Stripe.Event,
): Promise<PremiumEventAction | null> {
  if (
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    const restaurantId = session.metadata?.restaurantId;
    if (!restaurantId) return null;
    return {
      kind: "release",
      restaurantId,
      checkoutSessionId: session.id,
    };
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (
      session.mode !== "subscription" ||
      (session.payment_status !== "paid" &&
        session.payment_status !== "no_payment_required")
    ) {
      return null;
    }
    const subscriptionId = idOf(session.subscription);
    if (!subscriptionId) return null;
    const stripe = await getUncachableStripeClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const activation = activationFromSubscription(subscription);
    if (
      activation &&
      session.metadata?.restaurantId &&
      activation.restaurantId !== session.metadata.restaurantId
    ) {
      throw new Error("Stripe checkout and subscription metadata did not match.");
    }
    return activation;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.resumed"
  ) {
    const eventSubscription = event.data.object as Stripe.Subscription;
    const stripe = await getUncachableStripeClient();
    const currentSubscription = await stripe.subscriptions.retrieve(
      eventSubscription.id,
    );
    return activationFromSubscription(currentSubscription);
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const restaurantId = subscription.metadata.restaurantId;
    const customerId = idOf(subscription.customer);
    if (!restaurantId || !customerId) {
      throw new Error("Stripe subscription metadata was incomplete.");
    }
    return {
      kind: "cancel",
      restaurantId,
      customerId,
      subscriptionId: subscription.id,
    };
  }

  return null;
}

async function applyVerifiedEvent(event: Stripe.Event): Promise<void> {
  const action = await actionFromVerifiedEvent(event);
  if (!action) return;

  await db.transaction(async (tx) => {
    const [reserved] = await tx
      .insert(stripeProcessedEventsTable)
      .values({ eventId: event.id, eventType: event.type })
      .onConflictDoNothing()
      .returning({ eventId: stripeProcessedEventsTable.eventId });
    if (!reserved) return;

    if (action.kind === "activate") {
      const [existing] = await tx
        .select({
          placeId: restaurantsTable.placeId,
          claimEmail: restaurantsTable.claimEmail,
          claimStatus: restaurantsTable.claimStatus,
          premium: restaurantsTable.premium,
          customerId: restaurantsTable.stripeCustomerId,
        })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.placeId, action.restaurantId))
        .limit(1);
      if (!existing?.claimEmail || !existing.claimStatus) {
        throw new Error("Stripe restaurant mapping was not a completed claim.");
      }
      if (existing.customerId !== action.customerId) {
        throw new Error("Stripe customer did not match the restaurant claim.");
      }
      const [updated] = await tx
        .update(restaurantsTable)
        .set({
          premium: true,
          premiumSince: new Date(),
          premiumCancelledAt: null,
          stripeCustomerId: action.customerId,
          stripeSubscriptionId: action.subscriptionId,
          stripeCheckoutAttemptId: null,
          stripeCheckoutSessionId: null,
        })
        .where(eq(restaurantsTable.placeId, action.restaurantId))
        .returning({ placeId: restaurantsTable.placeId });
      if (!updated) throw new Error("Stripe restaurant mapping was missing.");
      if (!existing.premium) {
        await tx.insert(analyticsEventsTable).values({
          restaurantId: action.restaurantId,
          type: "premium_conversion",
          metadata: {},
        });
      }
    }

    if (action.kind === "release") {
      await tx
        .update(restaurantsTable)
        .set({
          stripeCheckoutAttemptId: null,
          stripeCheckoutSessionId: null,
        })
        .where(
          and(
            eq(restaurantsTable.placeId, action.restaurantId),
            eq(
              restaurantsTable.stripeCheckoutSessionId,
              action.checkoutSessionId,
            ),
            isNull(restaurantsTable.stripeSubscriptionId),
          ),
        );
    }

    if (action.kind === "cancel") {
      const [existing] = await tx
        .select({
          customerId: restaurantsTable.stripeCustomerId,
          checkoutSessionId: restaurantsTable.stripeCheckoutSessionId,
          subscriptionId: restaurantsTable.stripeSubscriptionId,
        })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.placeId, action.restaurantId))
        .limit(1);
      if (!existing) throw new Error("Stripe restaurant mapping was missing.");
      if (existing.customerId !== action.customerId) {
        throw new Error("Stripe customer did not match the restaurant claim.");
      }
      if (existing.subscriptionId === null) {
        if (!existing.checkoutSessionId) return;
        const stripe = await getUncachableStripeClient();
        const checkoutSession = await stripe.checkout.sessions.retrieve(
          existing.checkoutSessionId,
        );
        if (idOf(checkoutSession.subscription) !== action.subscriptionId) return;
        await tx
          .update(restaurantsTable)
          .set({
            stripeCheckoutAttemptId: null,
            stripeCheckoutSessionId: null,
          })
          .where(
            and(
              eq(restaurantsTable.placeId, action.restaurantId),
              eq(
                restaurantsTable.stripeCheckoutSessionId,
                existing.checkoutSessionId,
              ),
              isNull(restaurantsTable.stripeSubscriptionId),
            ),
          );
        return;
      }
      if (existing.subscriptionId !== action.subscriptionId) return;
      const [updated] = await tx
        .update(restaurantsTable)
        .set({
          premium: false,
          premiumCancelledAt: new Date(),
          stripeSubscriptionId: null,
        })
        .where(eq(restaurantsTable.placeId, action.restaurantId))
        .returning({ placeId: restaurantsTable.placeId });
      if (!updated) throw new Error("Stripe restaurant mapping was missing.");
    }
  });
}

export async function handleWebhook(
  payload: Buffer,
  signature: string,
): Promise<void> {
  if (!Buffer.isBuffer(payload)) throw new Error("Stripe payload must be raw.");
  const stripeSync = await getStripeSync();
  await stripeSync.processWebhook(payload, signature);

  let event: Stripe.Event;
  try {
    event = JSON.parse(payload.toString("utf8")) as Stripe.Event;
  } catch {
    throw new Error("Stripe event body was invalid.");
  }
  if (
    !event ||
    typeof event.id !== "string" ||
    !/^evt_[A-Za-z0-9]{8,128}$/.test(event.id) ||
    typeof event.type !== "string"
  ) {
    throw new Error("Stripe event envelope was invalid.");
  }
  await applyVerifiedEvent(event);
}

export default {
  createCheckoutSession,
  getCheckoutCompletion,
  handleWebhook,
};