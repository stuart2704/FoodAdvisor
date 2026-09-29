import { db, restaurantsTable, stripeCheckoutAlertsTable } from "@workspace/db";
import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getPremiumStripeClient } from "./stripeClient";
import { assertPremiumSubscription } from "./stripeService";

// Wait after independently observing payment so delayed webhook delivery has
// time to reconcile. A browser redirect or completion-status request cannot
// create or acknowledge these alerts.
export const CHECKOUT_ALERT_DELAY_MS = 15 * 60_000;

export async function checkPaidCheckoutAlerts(now = new Date()): Promise<void> {
  // Include sessions created before alert tracking was deployed.
  const pending = await db.select({
    restaurantId: restaurantsTable.placeId,
    sessionId: restaurantsTable.stripeCheckoutSessionId,
    customerId: restaurantsTable.stripeCustomerId,
  }).from(restaurantsTable)
    .where(and(eq(restaurantsTable.premium, false),
      isNull(restaurantsTable.stripeSubscriptionId),
      isNotNull(restaurantsTable.stripeCheckoutSessionId)))
    .limit(2000);
  for (const item of pending) {
    if (item.sessionId && item.customerId) {
      await db.insert(stripeCheckoutAlertsTable).values({
        sessionId: item.sessionId, restaurantId: item.restaurantId, customerId: item.customerId,
      }).onConflictDoNothing();
    }
  }

  let cursor: string | undefined;
  let stripeClient: Awaited<ReturnType<typeof getPremiumStripeClient>> | undefined;
  for (;;) {
    const candidates = await db.select().from(stripeCheckoutAlertsTable)
      .where(cursor
        ? and(isNull(stripeCheckoutAlertsTable.resolvedAt), gt(stripeCheckoutAlertsTable.sessionId, cursor))
        : isNull(stripeCheckoutAlertsTable.resolvedAt))
      .orderBy(asc(stripeCheckoutAlertsTable.sessionId))
      .limit(200);
    if (!candidates.length) break;
    stripeClient ??= await getPremiumStripeClient();
    const { stripe, livemode } = stripeClient;
    for (const candidate of candidates) {
      try {
        const [restaurant] = await db.select({
          name: restaurantsTable.name,
          claimStatus: restaurantsTable.claimStatus,
          claimEmail: restaurantsTable.claimEmail,
          customerId: restaurantsTable.stripeCustomerId,
          subscriptionId: restaurantsTable.stripeSubscriptionId,
          premium: restaurantsTable.premium,
        }).from(restaurantsTable).where(eq(restaurantsTable.placeId, candidate.restaurantId)).limit(1);
        const session = await stripe.checkout.sessions.retrieve(candidate.sessionId);
        const subscriptionId = typeof session.subscription === "string"
          ? session.subscription : session.subscription?.id ?? null;
        const paid = session.status === "complete" && session.payment_status === "paid" &&
          session.livemode === livemode;
        const mappingValid = session.mode === "subscription" &&
          session.metadata?.restaurantId === candidate.restaurantId &&
          (typeof session.customer === "string" ? session.customer : session.customer?.id) === candidate.customerId &&
          !!restaurant?.claimStatus && !!restaurant.claimEmail &&
          restaurant.customerId === candidate.customerId;

        if (paid && mappingValid && subscriptionId && restaurant?.premium &&
          restaurant.subscriptionId === subscriptionId) {
          // A database flag alone is not proof of reconciliation. Verify the
          // mapped paid subscription before closing an alert missed by webhook.
          const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ["items.data.price"],
          });
          assertPremiumSubscription(session, subscription);
          const [resolved] = await db.update(stripeCheckoutAlertsTable)
            .set({ resolvedAt: now, subscriptionId })
            .where(and(eq(stripeCheckoutAlertsTable.sessionId, candidate.sessionId),
              isNull(stripeCheckoutAlertsTable.resolvedAt)))
            .returning({ sessionId: stripeCheckoutAlertsTable.sessionId });
          if (resolved && candidate.alertedAt) logger.info({
            restaurantId: candidate.restaurantId, sessionId: candidate.sessionId, subscriptionId,
          }, "Paid checkout access alert resolved after reconciliation");
          continue;
        }
        // Unpaid/expired checkouts are not incidents. Keep open and async-payment
        // sessions under observation until Stripe confirms payment or expiry.
        if (session.status === "expired" && session.payment_status !== "paid") {
          await db.update(stripeCheckoutAlertsTable).set({ resolvedAt: now })
            .where(eq(stripeCheckoutAlertsTable.sessionId, candidate.sessionId));
          continue;
        }
        if (!paid) continue;
        const observedAt = candidate.paidObservedAt ?? now;
        if (!candidate.paidObservedAt) {
          await db.update(stripeCheckoutAlertsTable)
            .set({ paidObservedAt: observedAt, subscriptionId })
            .where(and(eq(stripeCheckoutAlertsTable.sessionId, candidate.sessionId),
              isNull(stripeCheckoutAlertsTable.paidObservedAt),
              isNull(stripeCheckoutAlertsTable.resolvedAt)));
        }
        if (now.getTime() - observedAt.getTime() < CHECKOUT_ALERT_DELAY_MS) continue;
        const [alerted] = await db.update(stripeCheckoutAlertsTable)
          .set({ alertedAt: now, subscriptionId })
          .where(and(eq(stripeCheckoutAlertsTable.sessionId, candidate.sessionId),
            isNull(stripeCheckoutAlertsTable.alertedAt),
            isNull(stripeCheckoutAlertsTable.resolvedAt)))
          .returning({ sessionId: stripeCheckoutAlertsTable.sessionId });
        if (alerted) logger.error({
          restaurantId: candidate.restaurantId,
          restaurantName: restaurant?.name,
          sessionId: candidate.sessionId,
          customerId: candidate.customerId,
          subscriptionId,
          mappingValid,
        }, "Paid Stripe checkout has not activated Premium access");
      } catch (error) {
        logger.error({ err: error, sessionId: candidate.sessionId },
          "Checkout alert verification failed; will retry");
      }
    }
    cursor = candidates.at(-1)!.sessionId;
  }
}

export async function listPaidCheckoutAlerts() {
  return db.select({
    restaurantId: stripeCheckoutAlertsTable.restaurantId,
    restaurantName: restaurantsTable.name,
    sessionId: stripeCheckoutAlertsTable.sessionId,
    customerId: stripeCheckoutAlertsTable.customerId,
    subscriptionId: stripeCheckoutAlertsTable.subscriptionId,
    paidObservedAt: stripeCheckoutAlertsTable.paidObservedAt,
    alertedAt: stripeCheckoutAlertsTable.alertedAt,
  }).from(stripeCheckoutAlertsTable)
    .leftJoin(restaurantsTable, eq(restaurantsTable.placeId, stripeCheckoutAlertsTable.restaurantId))
    .where(and(isNull(stripeCheckoutAlertsTable.resolvedAt),
      // Unalerted observations stay internal during the grace period.
      // SQL's IS NOT NULL avoids exposing pending unpaid sessions.
      isNotNull(stripeCheckoutAlertsTable.alertedAt)))
    .limit(200);
}