/**
 * Opt-in Stripe test-mode journey. Run only against a development database and
 * the running API workflow: pnpm --filter api-server run test:stripe-sandbox
 *
 * Uses the real hosted Checkout, not a fabricated "paid" event. Test cards
 * incur no real charge. Every test-owned customer/subscription and DB row is
 * removed in finally, including on assertion failures.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { eq, inArray } from "drizzle-orm";
import {
  analyticsEventsTable,
  db,
  pool,
  restaurantPortalTokensTable,
  restaurantsTable,
  stripeProcessedEventsTable,
} from "@workspace/db";
import { generateLoginToken } from "./portalTokenService";
import { getUncachableStripeClient } from "./stripeClient";

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.RUN_STRIPE_SANDBOX !== "1") {
    throw new Error("Set RUN_STRIPE_SANDBOX=1 in development only.");
  }
  const base = process.env.REPLIT_DEV_DOMAIN;
  if (!base || !process.env.NEON_DATABASE_URL || !process.env.STRIPE_PREMIUM_PRICE_ID) {
    throw new Error("A running development preview, development DB and sandbox Price are required.");
  }
  const stripe = await getUncachableStripeClient();
  const price = await stripe.prices.retrieve(process.env.STRIPE_PREMIUM_PRICE_ID);
  assert.equal(price.livemode, false, "Refusing to use a live Stripe Price");
  assert.equal(price.unit_amount, 9900);
  assert.equal(price.currency, "gbp");
  assert.equal(price.recurring?.interval, "month");
  const id = `stripe_sandbox_${randomUUID().replaceAll("-", "")}`;
  const url = `https://${base}`;
  let customerId: string | null = null;
  let sessionId: string | null = null;
  let subscriptionId: string | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let failure: unknown;
  const createdAfter = Math.floor(Date.now() / 1000) - 60;
  try {
    await db.insert(restaurantsTable).values({
      placeId: id,
      name: "Stripe Sandbox Regression",
      address: "Test record",
      city: "Test",
      googleMapsUrl: "https://maps.google.com/",
      claimEmail: `${id}@example.test`,
      claimStatus: "basic",
    });
    const token = await generateLoginToken(id);
    const checkout = () => fetch(`${url}/api/restaurants/${id}/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ portalToken: token }),
    });
    const [a, b] = await Promise.all([checkout(), checkout()]);
    assert.equal(a.status, 201, a.status === 201 ? "" : await a.text());
    assert.equal(b.status, 201, b.status === 201 ? "" : await b.text());
    const first = (await a.json()) as { url: string };
    const second = (await b.json()) as { url: string };
    assert.equal(first.url, second.url, "Concurrent checkout created two sessions");
    const [pending] = await db.select().from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, id));
    assert.equal(pending.stripeCheckoutAttempt, 1);
    assert.equal(pending.premium, false);
    customerId = pending.stripeCustomerId;
    sessionId = pending.stripeCheckoutSessionId;
    assert.ok(customerId && sessionId);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    assert.equal(session.customer, customerId);
    assert.equal(session.metadata?.restaurantId, id);
    assert.equal(session.amount_total, 9900);
    assert.equal(session.livemode, false);
    const forged = await fetch(`${url}/api/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "forged" },
      body: JSON.stringify({ type: "checkout.session.completed", data: { object: session } }),
    });
    assert.equal(forged.status, 400, "Forged webhook was accepted");
    const [beforePayment] = await db.select().from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, id));
    assert.equal(beforePayment.premium, false);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(first.url);
    await page.locator('input[name="cardNumber"]').fill("4242424242424242");
    await page.locator('input[name="cardExpiry"]').fill("1234");
    await page.locator('input[name="cardCvc"]').fill("123");
    await page.getByLabel(/cardholder name/i).fill("Sandbox Owner");
    await page.locator('select[name="billingCountry"]').selectOption("GB");
    if (await page.locator('input[name="billingPostalCode"]').isVisible()) {
      await page.locator('input[name="billingPostalCode"]').fill("SW1A 1AA");
    }
    // Checkout account settings, not the session request, determine whether
    // a phone field appears. Fill it only when Stripe renders it.
    if (await page.locator('input[name="phoneNumber"]').isVisible()) {
      await page.locator('input[name="phoneNumber"]').fill("7700900123");
    }
    await page.getByRole("button", { name: /subscribe|pay/i }).last().click();
    try {
      await page.waitForURL(/\/portal\/upgrade\/success/, { timeout: 30_000, waitUntil: "commit" });
    } catch (error) {
      throw new Error(
        `Checkout did not redirect: ${(await page.locator("body").innerText()).slice(-1200)}; ` +
        `invalid fields: ${JSON.stringify(await page.locator('[aria-invalid="true"]').evaluateAll(
          nodes => nodes.map(node => ({
            name: node.getAttribute("name"),
            context: node.parentElement?.parentElement?.textContent?.slice(0, 160),
          })),
        ))}`,
        { cause: error },
      );
    }
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const [row] = await db.select().from(restaurantsTable)
        .where(eq(restaurantsTable.placeId, id));
      if (row.premium && row.stripeSubscriptionId) {
        subscriptionId = row.stripeSubscriptionId;
        break;
      }
      await sleep(1500);
    }
    assert.ok(subscriptionId, "Paid checkout did not activate the claimed restaurant");
    const paidSession = await stripe.checkout.sessions.retrieve(sessionId);
    assert.equal(paidSession.payment_status, "paid");
    assert.equal(paidSession.subscription, subscriptionId);
    const paidSubscription = await stripe.subscriptions.retrieve(subscriptionId);
    assert.equal(paidSubscription.customer, customerId);
    assert.equal(paidSubscription.items.data[0].price.id, price.id);
    const repeat = await checkout();
    assert.equal(repeat.status, 409, "Subscribed owner could start another checkout");
    process.stdout.write("Sandbox checkout activated exactly one Premium subscription.\n");
  } catch (error) {
    failure = error;
  } finally {
    try {
      await browser?.close();
      // A Stripe customer/session can exist even if the database transaction
      // failed after the remote create. Discover these test-owned objects.
      const customers = await stripe.customers.list({
        email: `${id}@example.test`,
        limit: 10,
      });
      const ownedCustomers = customers.data.filter(c => c.metadata.restaurantId === id);
      for (const customer of ownedCustomers) {
        const sessions = await stripe.checkout.sessions.list({
          customer: customer.id,
          limit: 100,
        });
        for (const session of sessions.data) {
          if (session.metadata?.restaurantId !== id) continue;
          if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
          if (typeof session.subscription === "string") subscriptionId = session.subscription;
          sessionId = session.id;
        }
      }
      // Retrieve IDs again if the browser payment completed just before failure.
      if (sessionId) {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.status === "open") await stripe.checkout.sessions.expire(sessionId);
        if (typeof session.subscription === "string") subscriptionId = session.subscription;
      }
      if (subscriptionId) await stripe.subscriptions.cancel(subscriptionId);
      for (const customer of ownedCustomers) await stripe.customers.del(customer.id);
      // Let managed webhook delivery of cancellation/deletion settle before
      // removing application event records.
      await sleep(2000);

      // Only delete processed event IDs whose Stripe objects belong to this run.
      const ids: string[] = [];
      for await (const event of stripe.events.list({ created: { gte: createdAfter }, limit: 100 })) {
        const object = event.data.object as { id?: string; customer?: string; metadata?: { restaurantId?: string } };
        if (object.id === sessionId || object.id === subscriptionId ||
            ownedCustomers.some(customer => object.id === customer.id) ||
            object.customer === customerId || object.metadata?.restaurantId === id) {
          ids.push(event.id);
        }
      }
      if (ids.length) await db.delete(stripeProcessedEventsTable)
        .where(inArray(stripeProcessedEventsTable.eventId, ids));
      await db.delete(analyticsEventsTable).where(eq(analyticsEventsTable.restaurantId, id));
      await db.delete(restaurantPortalTokensTable).where(eq(restaurantPortalTokensTable.placeId, id));
      await db.delete(restaurantsTable).where(eq(restaurantsTable.placeId, id));
      const [remaining] = await db.select({ placeId: restaurantsTable.placeId })
        .from(restaurantsTable).where(eq(restaurantsTable.placeId, id));
      assert.equal(remaining, undefined, "Sandbox restaurant cleanup failed");
    } catch (cleanupError) {
      failure = new AggregateError(
        failure ? [failure, cleanupError] : [cleanupError],
        `Sandbox cleanup failed for ${id}; inspect and remove test records`,
      );
    } finally {
      await pool.end();
    }
  }
  if (failure) throw failure;
}

await main();