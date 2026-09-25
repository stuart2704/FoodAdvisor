import Stripe from "stripe";
import {
  analyticsEventsTable,
  db,
  restaurantsTable,
  stripeProcessedEventsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { assertPublicHttpsUrl } from "../lib/public-url";
import { validateToken } from "./portalTokenService";
import {
  closeStripeSync,
  getPremiumPriceId,
  getPremiumStripeClient,
  getStripeSync,
  getUncachableStripeClient,
  verifyStripeEvent,
} from "./stripeClient";

export async function createCheckoutSession(
  portalToken: string,
): Promise<string> {
  const placeId = await validateToken(portalToken);
  if (!placeId) throw new Error("Invalid or expired portal login.");
  const { stripe, livemode } = await getPremiumStripeClient();
  const configuredPrice = await stripe.prices.retrieve(getPremiumPriceId(livemode));
  assertPremiumPrice(configuredPrice, livemode);
  const publicUrl = await assertPublicHttpsUrl(process.env.PUBLIC_APP_URL, {
    canonical: true,
  });
  return db.transaction(async (tx) => {
    await lockRestaurant(tx, placeId);
    const [restaurant] = await tx
      .select({
        placeId: restaurantsTable.placeId,
        name: restaurantsTable.name,
        email: restaurantsTable.claimEmail,
        claimStatus: restaurantsTable.claimStatus,
        customerId: restaurantsTable.stripeCustomerId,
        subscriptionId: restaurantsTable.stripeSubscriptionId,
        checkoutSessionId: restaurantsTable.stripeCheckoutSessionId,
        checkoutAttempt: restaurantsTable.stripeCheckoutAttempt,
        premium: restaurantsTable.premium,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, placeId))
      .limit(1);
    if (!restaurant?.email || restaurant.claimStatus === null) {
      throw new Error("A claimed business email is required.");
    }
    if (restaurant.premium || restaurant.subscriptionId) {
      throw new Error("This restaurant already has a subscription.");
    }

    let customerId = restaurant.customerId;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email: restaurant.email,
          name: restaurant.name,
          metadata: { restaurantId: restaurant.placeId },
        },
        { idempotencyKey: `restaurant-customer-${restaurant.placeId}` },
      );
      customerId = customer.id;
    }

    if (restaurant.checkoutSessionId) {
      const existingSession = await stripe.checkout.sessions.retrieve(
        restaurant.checkoutSessionId,
        { expand: ["line_items.data.price"] },
      );
      if (isExpectedOpenCheckout(existingSession, restaurant.placeId, customerId)) {
        return existingSession.url!;
      }
      if (existingSession.status === "open") {
        await stripe.checkout.sessions.expire(existingSession.id);
      }
    }

    const attempt = restaurant.checkoutAttempt + 1;
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: configuredPrice.id, quantity: 1 }],
        // Keep idempotent request parameters independent of rotating portal
        // tokens. The frontend retains its authenticated portal context while
        // Stripe redirects to these stable completion/cancellation routes.
        success_url: `${publicUrl}/portal/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${publicUrl}/portal/upgrade/cancel`,
        metadata: { restaurantId: restaurant.placeId },
        subscription_data: {
          metadata: { restaurantId: restaurant.placeId },
        },
      },
      {
        idempotencyKey: `premium-checkout-${restaurant.placeId}-${attempt}`,
      },
    );
    if (!session.url) throw new Error("Stripe checkout URL was not returned.");
    await tx
      .update(restaurantsTable)
      .set({
        stripeCustomerId: customerId,
        stripeCheckoutSessionId: session.id,
        stripeCheckoutAttempt: attempt,
      })
      .where(eq(restaurantsTable.placeId, restaurant.placeId));
    return session.url;
  });
}

async function applyCheckoutCompleted(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  session: Stripe.Checkout.Session,
  subscription: Stripe.Subscription,
): Promise<void> {
  assertPremiumSubscription(session, subscription);
  const restaurantId = session.metadata!.restaurantId;
  const customerId = idOf(session.customer)!;

  await lockRestaurant(tx, restaurantId);
  const [existing] = await tx
    .select({
      placeId: restaurantsTable.placeId,
      claimStatus: restaurantsTable.claimStatus,
      claimEmail: restaurantsTable.claimEmail,
      customerId: restaurantsTable.stripeCustomerId,
      subscriptionId: restaurantsTable.stripeSubscriptionId,
      premium: restaurantsTable.premium,
    })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, restaurantId))
    .limit(1);
  if (
    !existing ||
    existing.claimStatus === null ||
    !existing.claimEmail ||
    existing.customerId !== customerId
  ) {
    throw new Error("Stripe customer was not mapped to a claimed restaurant.");
  }
  if (
    existing.subscriptionId !== null &&
    existing.subscriptionId !== subscription.id
  ) {
    throw new Error("Restaurant already has a different Stripe subscription.");
  }

  const [updated] = await tx
    .update(restaurantsTable)
    .set({
      premium: true,
      premiumSince: existing.premium ? undefined : new Date(),
      premiumCancelledAt: null,
      stripeSubscriptionId: subscription.id,
      stripeCheckoutSessionId: session.id,
    })
    .where(
      and(
        eq(restaurantsTable.placeId, restaurantId),
        eq(restaurantsTable.stripeCustomerId, customerId),
        eq(restaurantsTable.claimStatus, existing.claimStatus),
      ),
    )
    .returning({ placeId: restaurantsTable.placeId });
  if (!updated) throw new Error("Stripe restaurant mapping changed.");
  if (!existing.premium) {
    await tx.insert(analyticsEventsTable).values({
      restaurantId,
      type: "premium_conversion",
      metadata: {},
    });
  }
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

function idOf(
  value: string | { id: string } | Stripe.DeletedCustomer | null,
): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function isSignatureError(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeSignatureVerificationError ||
    (typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "StripeSignatureVerificationError")
  );
}

async function applyVerifiedEvent(event: Stripe.Event): Promise<void> {
  let subscription: Stripe.Subscription | null = null;
  const isCheckoutEvent =
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded";
  const checkoutSession = isCheckoutEvent
    ? (event.data.object as Stripe.Checkout.Session)
    : null;
  const shouldActivate =
    checkoutSession !== null && checkoutSession.payment_status === "paid";
  if (
    event.type === "checkout.session.async_payment_succeeded" &&
    !shouldActivate
  ) {
    throw new Error("Stripe async payment success event was not paid.");
  }
  if (shouldActivate) {
    const subscriptionId = idOf(checkoutSession.subscription);
    if (!subscriptionId) {
      throw new Error("Stripe checkout subscription was missing.");
    }
    const stripe = await getUncachableStripeClient();
    subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    });
  }

  await db.transaction(async (tx) => {
    const [reserved] = await tx
      .insert(stripeProcessedEventsTable)
      .values({ eventId: event.id, eventType: event.type })
      .onConflictDoNothing()
      .returning({ eventId: stripeProcessedEventsTable.eventId });
    if (!reserved) return;

    if (shouldActivate) {
      await applyCheckoutCompleted(
        tx,
        checkoutSession!,
        subscription!,
      );
    } else if (event.type === "customer.subscription.deleted") {
      await applySubscriptionDeleted(
        tx,
        event.data.object as Stripe.Subscription,
      );
    }
  });
}

export async function handleWebhook(
  payload: Buffer,
  signature: string,
): Promise<void> {
  if (!Buffer.isBuffer(payload)) throw new Error("Stripe payload must be raw.");
  let event: Stripe.Event;
  try {
    event = await verifyStripeEvent(payload, signature);
  } catch (error) {
    if (isSignatureError(error)) throw new StripeWebhookSignatureError(error);
    throw error;
  }
  const sync = await getStripeSync();
  try {
    await sync.processEvent(event);
  } finally {
    await closeStripeSync(sync);
  }
  await applyVerifiedEvent(event);
}

export default {
  createCheckoutSession,
  getCheckoutCompletion,
  handleWebhook,
};

const PREMIUM_AMOUNT = 9_900;

async function lockRestaurant(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  placeId: string,
): Promise<void> {
  await tx.execute(sql`
    select ${restaurantsTable.placeId}
      from ${restaurantsTable}
     where ${restaurantsTable.placeId} = ${placeId}
     for update
  `);
}

async function applySubscriptionDeleted(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  subscription: Stripe.Subscription,
): Promise<void> {
  const restaurantId = subscription.metadata.restaurantId;
  const customerId = idOf(subscription.customer);
  if (!restaurantId || !customerId) {
    throw new Error("Stripe subscription metadata was incomplete.");
  }
  await lockRestaurant(tx, restaurantId);
  const [restaurant] = await tx
    .select({
      customerId: restaurantsTable.stripeCustomerId,
      subscriptionId: restaurantsTable.stripeSubscriptionId,
    })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, restaurantId))
    .limit(1);
  if (!restaurant || restaurant.customerId !== customerId) {
    throw new Error("Stripe customer was not mapped to this restaurant.");
  }
  // A delayed deletion for an older subscription must not remove a newer
  // entitlement. It is nevertheless successfully processed and acknowledged.
  if (restaurant.subscriptionId !== subscription.id) return;
  await tx
    .update(restaurantsTable)
    .set({
      premium: false,
      premiumCancelledAt: new Date(),
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
    })
    .where(
      and(
        eq(restaurantsTable.placeId, restaurantId),
        eq(restaurantsTable.stripeCustomerId, customerId),
        eq(restaurantsTable.stripeSubscriptionId, subscription.id),
      ),
    );
}

export function assertPremiumSubscription(
  session: Stripe.Checkout.Session,
  subscription: Stripe.Subscription,
): void {
  const restaurantId = session.metadata?.restaurantId;
  const subscriptionRestaurantId = subscription.metadata.restaurantId;
  const sessionCustomerId = idOf(session.customer);
  const subscriptionCustomerId = idOf(subscription.customer);
  const sessionSubscriptionId = idOf(session.subscription);
  const items = subscription.items.data;
  const item = items[0];
  const price = item?.price;

  if (
    session.mode !== "subscription" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    session.amount_total !== PREMIUM_AMOUNT ||
    session.currency?.toLowerCase() !== PREMIUM_CURRENCY ||
    !restaurantId ||
    subscriptionRestaurantId !== restaurantId ||
    sessionSubscriptionId !== subscription.id ||
    !sessionCustomerId ||
    subscriptionCustomerId !== sessionCustomerId ||
    subscription.status !== "active" ||
    items.length !== 1 ||
    item.quantity !== 1 ||
    price.id !== getPremiumPriceId(session.livemode)
  ) {
    throw new Error("Stripe subscription did not match the Premium plan.");
  }
  assertPremiumPrice(price, session.livemode);
  if (session.livemode !== subscription.livemode) {
    throw new Error("Stripe checkout and subscription modes did not match.");
  }
}

const PREMIUM_CURRENCY = "gbp";

function isExpectedOpenCheckout(
  session: Stripe.Checkout.Session,
  restaurantId: string,
  customerId: string,
): boolean {
  const item = session.line_items?.data[0];
  const price =
    item?.price && typeof item.price !== "string" ? item.price : null;
  if (
    session.status !== "open" ||
    !session.url ||
    session.mode !== "subscription" ||
    session.metadata?.restaurantId !== restaurantId ||
    idOf(session.customer) !== customerId ||
    session.amount_total !== PREMIUM_AMOUNT ||
    session.currency?.toLowerCase() !== PREMIUM_CURRENCY ||
    session.line_items?.data.length !== 1 ||
    item?.quantity !== 1 ||
    !price
  ) {
    return false;
  }
  try {
    assertPremiumPrice(price, session.livemode);
    return true;
  } catch {
    return false;
  }
}

export function assertPremiumPrice(
  price: Stripe.Price,
  expectedLivemode = price.livemode,
): void {
  if (
    price.livemode !== expectedLivemode ||
    price.id !== getPremiumPriceId(expectedLivemode) ||
    price.active !== true ||
    price.type !== "recurring" ||
    price.currency.toLowerCase() !== PREMIUM_CURRENCY ||
    price.unit_amount !== PREMIUM_AMOUNT ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1
  ) {
    throw new Error("Configured Stripe Price is not £99 GBP monthly.");
  }
}

export class StripeWebhookSignatureError extends Error {
  constructor(cause: unknown) {
    super("Invalid Stripe webhook signature.", { cause });
    this.name = "StripeWebhookSignatureError";
  }
}
