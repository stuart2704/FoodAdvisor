import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const temp = await mkdtemp(path.join(os.tmpdir(), "stripe-service-test-"));
after(() => rm(temp, { recursive: true, force: true }));

const files = {
  db: path.join(temp, "db.mjs"),
  orm: path.join(temp, "orm.mjs"),
  client: path.join(temp, "client.mjs"),
  portal: path.join(temp, "portal.mjs"),
  publicUrl: path.join(temp, "public-url.mjs"),
  output: path.join(temp, "service.mjs"),
};

await Promise.all([
  writeFile(files.orm, `
export const eq = (column, expected) => ({ kind: "eq", column, expected });
export const and = (...conditions) => ({ kind: "and", conditions });
export const sql = (strings, ...values) => ({ kind: "sql", strings, values });
`),
  writeFile(files.portal, `export const validateToken = async () => "rest_1";`),
  writeFile(files.publicUrl, `export const assertPublicHttpsUrl = async () => "https://example.test";`),
  writeFile(files.client, `
export const verifyStripeEvent = async () => {
  if (globalThis.__stripe.signatureError) throw { type: "StripeSignatureVerificationError" };
  if (globalThis.__stripe.verifyError) throw new Error("secret unavailable");
  return globalThis.__stripe.event;
};
export const getUncachableStripeClient = async () => ({
  prices: {
    retrieve: async () => {
      globalThis.__stripe.priceCalls += 1;
      return globalThis.__stripe.configuredPrice;
    },
  },
  customers: {
    create: async () => ({ id: "cus_owner" }),
  },
  checkout: {
    sessions: {
      retrieve: async (id) => id === "cs_test_created"
        ? { ...globalThis.__stripe.existingCheckoutSession, id, url: "https://checkout.stripe.com/c/pay/new" }
        : globalThis.__stripe.existingCheckoutSession,
      expire: async () => { globalThis.__stripe.checkoutExpires += 1; },
      create: async (params, options) => {
        globalThis.__stripe.checkoutCreates.push({ params, options });
        return {
          id: "cs_test_created",
          url: "https://checkout.stripe.com/c/pay/new",
        };
      },
    },
  },
  subscriptions: { retrieve: async () => globalThis.__stripe.subscription },
});
export const getStripeSync = async () => ({
  processEvent: async () => { globalThis.__stripe.syncCalls += 1; },
});
export const closeStripeSync = async () => { globalThis.__stripe.closeCalls += 1; };
`),
  writeFile(files.db, `
const table = (name, columns) => Object.assign({ name }, Object.fromEntries(columns.map(column => [column, { column }])));
export const restaurantsTable = table("restaurants", [
  "placeId", "name", "claimEmail", "claimStatus", "stripeCustomerId",
  "stripeSubscriptionId", "stripeCheckoutSessionId", "stripeCheckoutAttempt",
  "premium", "premiumSince", "premiumCancelledAt"
]);
export const stripeProcessedEventsTable = table("events", ["eventId", "eventType"]);
export const analyticsEventsTable = table("analytics", ["restaurantId", "type", "metadata"]);
const state = () => globalThis.__stripe;
const matches = (condition, row) => {
  if (!condition) return true;
  if (condition.kind === "and") return condition.conditions.every(c => matches(c, row));
  return row[condition.column.column] === condition.expected;
};
const project = (selection, row) => Object.fromEntries(
  Object.entries(selection).map(([key, column]) => [key, row[column.column]])
);
const transaction = {
  async execute() {
    state().lockCalls += 1;
    // A real FOR UPDATE waits for the previous transaction. The optional
    // deferred gate makes concurrent calls exercise that ordering here.
    if (state().lockGate) await state().lockGate;
  },
  insert(table) {
    return {
      values(value) {
        if (table.name === "analytics") {
          state().analytics.push(value);
          return Promise.resolve();
        }
        return {
          onConflictDoNothing() {
            return {
              async returning() {
                if (state().events.has(value.eventId)) return [];
                state().events.add(value.eventId);
                return [{ eventId: value.eventId }];
              }
            };
          }
        };
      }
    };
  },
  select(selection) {
    return { from() { return { where(condition) { return { async limit() {
      const row = state().restaurant;
      return row && matches(condition, row) ? [project(selection, row)] : [];
    } }; } }; } };
  },
  update() {
    return { set(values) { return { where(condition) {
      const run = () => {
        const row = state().restaurant;
        if (!row || !matches(condition, row)) return [];
        Object.assign(row, Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)));
        state().updates += 1;
        return [row];
      };
      return {
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
        async returning(selection) {
          const rows = run();
          return rows.map(row => project(selection, row));
        }
      };
    } }; } };
  }
};
export const db = {
  async transaction(operation) {
    const previous = state().transactionQueue ?? Promise.resolve();
    let release;
    state().transactionQueue = new Promise(resolve => { release = resolve; });
    await previous;
    const snapshot = structuredClone({
      restaurant: state().restaurant,
      events: [...state().events],
      analytics: state().analytics,
      updates: state().updates,
    });
    try {
      return await operation(transaction);
    } catch (error) {
      state().restaurant = snapshot.restaurant;
      state().events = new Set(snapshot.events);
      state().analytics = snapshot.analytics;
      state().updates = snapshot.updates;
      throw error;
    } finally {
      release();
    }
  }
};
`),
]);

await build({
  entryPoints: [path.resolve(import.meta.dirname, "stripeService.ts")],
  outfile: files.output,
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "stripe-test-mocks",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: files.db }));
      builder.onResolve({ filter: /^drizzle-orm$/ }, () => ({ path: files.orm }));
      builder.onResolve({ filter: /stripeClient$/ }, () => ({ path: files.client }));
      builder.onResolve({ filter: /portalTokenService$/ }, () => ({ path: files.portal }));
      builder.onResolve({ filter: /lib\/public-url$/ }, () => ({ path: files.publicUrl }));
    },
  }],
});

const {
  assertPremiumPrice,
  createCheckoutSession,
  handleWebhook,
  StripeWebhookSignatureError,
} = await import(
  `${pathToFileURL(files.output).href}?v=1`
);

process.env.STRIPE_PREMIUM_PRICE_ID = "price_premium99";

function baseState() {
  const session = {
    id: "cs_test_valid",
    object: "checkout.session",
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    amount_total: 9900,
    currency: "gbp",
    customer: "cus_owner",
    subscription: "sub_paid",
    metadata: { restaurantId: "rest_1" },
    livemode: false,
  };
  const subscription = {
    id: "sub_paid",
    object: "subscription",
    customer: "cus_owner",
    status: "active",
    metadata: { restaurantId: "rest_1" },
    livemode: false,
    items: {
      data: [{
        quantity: 1,
        price: {
          id: "price_premium99",
          active: true,
          type: "recurring",
          currency: "gbp",
          unit_amount: 9900,
          recurring: { interval: "month", interval_count: 1 },
        },
      }],
    },
  };
  return {
    restaurant: {
      placeId: "rest_1",
      name: "Claimed Restaurant",
      claimEmail: "owner@example.test",
      claimStatus: "basic",
      stripeCustomerId: "cus_owner",
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
      stripeCheckoutAttempt: 0,
      premium: false,
      premiumSince: null,
      premiumCancelledAt: null,
    },
    event: {
      id: "evt_paid",
      type: "checkout.session.completed",
      data: { object: session },
    },
    subscription,
    events: new Set(),
    analytics: [],
    updates: 0,
    syncCalls: 0,
    closeCalls: 0,
    lockCalls: 0,
    priceCalls: 0,
    checkoutCreates: [],
    checkoutExpires: 0,
    existingCheckoutSession: {
      id: "cs_test_existing",
      status: "open",
      url: "https://checkout.stripe.com/c/pay/existing",
      mode: "subscription",
      customer: "cus_owner",
      metadata: { restaurantId: "rest_1" },
      amount_total: 9900,
      currency: "gbp",
      line_items: { data: [{
        quantity: 1,
        price: subscription.items.data[0].price,
      }] },
    },
    signatureError: false,
    verifyError: false,
  };
}

test("valid paid £99 monthly event activates only the mapped basic claim", async () => {
  globalThis.__stripe = baseState();
  await handleWebhook(Buffer.from("{}"), "valid");
  assert.equal(globalThis.__stripe.restaurant.premium, true);
  assert.equal(globalThis.__stripe.restaurant.stripeSubscriptionId, "sub_paid");
  assert.equal(globalThis.__stripe.restaurant.claimStatus, "basic");
  assert.equal(globalThis.__stripe.analytics.length, 1);
  assert.equal(globalThis.__stripe.lockCalls, 1);
  assert.equal(globalThis.__stripe.closeCalls, 1);
});

test("configured Price must be active £99 GBP monthly before checkout", () => {
  const price = globalThis.__stripe?.subscription?.items.data[0].price ??
    baseState().subscription.items.data[0].price;
  assert.doesNotThrow(() => assertPremiumPrice(price));
  assert.throws(
    () => assertPremiumPrice({ ...price, currency: "usd" }),
    /£99 GBP monthly/,
  );
  assert.throws(
    () => assertPremiumPrice({
      ...price,
      recurring: { interval: "year", interval_count: 1 },
    }),
    /£99 GBP monthly/,
  );
});

test("checkout validates Price, reuses open sessions, and rotates expired attempts", async () => {
  globalThis.__stripe = baseState();
  globalThis.__stripe.configuredPrice =
    globalThis.__stripe.subscription.items.data[0].price;
  globalThis.__stripe.restaurant.stripeCheckoutSessionId = "cs_test_existing";
  const reused = await createCheckoutSession("portal-token");
  assert.equal(reused, "https://checkout.stripe.com/c/pay/existing");
  assert.equal(globalThis.__stripe.checkoutCreates.length, 0);
  assert.equal(globalThis.__stripe.lockCalls, 1);

  globalThis.__stripe.existingCheckoutSession.status = "expired";
  const created = await createCheckoutSession("different-portal-token");
  assert.equal(created, "https://checkout.stripe.com/c/pay/new");
  assert.equal(globalThis.__stripe.checkoutCreates.length, 1);
  const request = globalThis.__stripe.checkoutCreates[0];
  assert.equal(
    request.options.idempotencyKey,
    "premium-checkout-rest_1-1",
  );
  assert.doesNotMatch(request.params.success_url, /portal-token/);
  assert.equal(globalThis.__stripe.restaurant.stripeCheckoutAttempt, 1);
  assert.equal(
    globalThis.__stripe.restaurant.stripeCheckoutSessionId,
    "cs_test_created",
  );

  globalThis.__stripe = baseState();
  globalThis.__stripe.configuredPrice = {
    ...globalThis.__stripe.subscription.items.data[0].price,
    unit_amount: 10_000,
  };
  await assert.rejects(createCheckoutSession("portal-token"), /£99 GBP monthly/);
  assert.equal(globalThis.__stripe.checkoutCreates.length, 0);
});

test("simultaneous portal checkouts reuse a single pending session", async () => {
  globalThis.__stripe = baseState();
  const state = globalThis.__stripe;
  state.configuredPrice = state.subscription.items.data[0].price;
  // Simulate Stripe returning the newly created session on the second read.
  const first = createCheckoutSession("portal-token");
  const second = createCheckoutSession("portal-token");
  const urls = await Promise.all([first, second]);
  assert.deepEqual(urls, [urls[0], urls[0]]);
  assert.equal(state.checkoutCreates.length, 1);
  assert.equal(state.restaurant.stripeCheckoutAttempt, 1);
});

test("async failure and expiry cannot activate or clear a newer checkout", async () => {
  globalThis.__stripe = baseState();
  const state = globalThis.__stripe;
  state.restaurant.stripeCheckoutSessionId = "cs_test_newer";
  for (const type of [
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
  ]) {
    state.event = {
      id: `evt_${type}`,
      type,
      data: { object: { ...baseState().event.data.object, id: "cs_test_older", payment_status: "unpaid" } },
    };
    await handleWebhook(Buffer.from("{}"), "valid");
    assert.equal(state.restaurant.premium, false);
    assert.equal(state.restaurant.stripeCheckoutSessionId, "cs_test_newer");
  }
});

test("incorrect metadata, price ID, and customer cannot grant access", async () => {
  for (const mutate of [
    s => { s.event.data.object.metadata.restaurantId = "rest_other"; },
    s => { s.subscription.metadata.restaurantId = "rest_other"; },
    s => { s.subscription.items.data[0].price.id = "price_other"; },
    s => { s.subscription.customer = "cus_other"; },
  ]) {
    globalThis.__stripe = baseState();
    mutate(globalThis.__stripe);
    await assert.rejects(handleWebhook(Buffer.from("{}"), "valid"));
    assert.equal(globalThis.__stripe.restaurant.premium, false);
    assert.equal(globalThis.__stripe.events.size, 0);
  }
});

test("unpaid completion is acknowledged pending and async payment activates", async () => {
  globalThis.__stripe = baseState();
  globalThis.__stripe.event.data.object.payment_status = "unpaid";
  await handleWebhook(Buffer.from("{}"), "valid");
  assert.equal(globalThis.__stripe.restaurant.premium, false);
  assert.equal(globalThis.__stripe.events.has("evt_paid"), true);

  globalThis.__stripe.event = {
    id: "evt_async_paid",
    type: "checkout.session.async_payment_succeeded",
    data: {
      object: {
        ...globalThis.__stripe.event.data.object,
        payment_status: "paid",
      },
    },
  };
  await handleWebhook(Buffer.from("{}"), "valid");
  assert.equal(globalThis.__stripe.restaurant.premium, true);
});

test("checkout and subscription livemode must match", async () => {
  globalThis.__stripe = baseState();
  globalThis.__stripe.subscription.livemode = true;
  await assert.rejects(handleWebhook(Buffer.from("{}"), "valid"), /modes/);
  assert.equal(globalThis.__stripe.restaurant.premium, false);
  assert.equal(globalThis.__stripe.events.size, 0);
});

test("bad signature is classified separately and never writes", async () => {
  globalThis.__stripe = baseState();
  globalThis.__stripe.signatureError = true;
  await assert.rejects(
    handleWebhook(Buffer.from("{}"), "bad"),
    StripeWebhookSignatureError,
  );
  assert.equal(globalThis.__stripe.events.size, 0);
});

test("HTTP route returns 400 only for signatures and 500 for processing", async () => {
  const appSource = await readFile(
    path.resolve(import.meta.dirname, "../app.ts"),
    "utf8",
  );
  assert.match(
    appSource,
    /error instanceof StripeWebhookSignatureError[\s\S]*?status\(400\)/,
  );
  assert.match(
    appSource,
    /Stripe webhook processing failed[\s\S]*?status\(500\)/,
  );
});

test("wrong customer mapping and wrong price roll back event reservation", async () => {
  globalThis.__stripe = baseState();
  globalThis.__stripe.restaurant.stripeCustomerId = "cus_other";
  await assert.rejects(handleWebhook(Buffer.from("{}"), "valid"), /not mapped/);
  assert.equal(globalThis.__stripe.events.size, 0);
  assert.equal(globalThis.__stripe.restaurant.premium, false);

  globalThis.__stripe = baseState();
  globalThis.__stripe.subscription.items.data[0].price.unit_amount = 10_000;
  await assert.rejects(
    handleWebhook(Buffer.from("{}"), "valid"),
    /£99 GBP monthly/,
  );
  assert.equal(globalThis.__stripe.events.size, 0);
});

test("duplicate event is an idempotent no-op", async () => {
  globalThis.__stripe = baseState();
  await handleWebhook(Buffer.from("{}"), "valid");
  const updates = globalThis.__stripe.updates;
  await handleWebhook(Buffer.from("{}"), "valid");
  assert.equal(globalThis.__stripe.updates, updates);
  assert.equal(globalThis.__stripe.analytics.length, 1);
});

test("matching cancellation removes Premium but preserves the basic claim", async () => {
  globalThis.__stripe = baseState();
  globalThis.__stripe.restaurant.premium = true;
  globalThis.__stripe.restaurant.stripeSubscriptionId = "sub_paid";
  globalThis.__stripe.event = {
    id: "evt_cancel",
    type: "customer.subscription.deleted",
    data: { object: globalThis.__stripe.subscription },
  };
  await handleWebhook(Buffer.from("{}"), "valid");
  assert.equal(globalThis.__stripe.restaurant.premium, false);
  assert.equal(globalThis.__stripe.restaurant.stripeSubscriptionId, null);
  assert.equal(globalThis.__stripe.restaurant.claimStatus, "basic");
  assert.equal(globalThis.__stripe.restaurant.claimEmail, "owner@example.test");
});

test("stale cancellation cannot remove a newer subscription", async () => {
  globalThis.__stripe = baseState();
  globalThis.__stripe.restaurant.premium = true;
  globalThis.__stripe.restaurant.stripeSubscriptionId = "sub_new";
  globalThis.__stripe.restaurant.stripeCheckoutSessionId = "cs_test_newer";
  globalThis.__stripe.event = {
    id: "evt_stale_cancel",
    type: "customer.subscription.deleted",
    data: { object: globalThis.__stripe.subscription },
  };
  await handleWebhook(Buffer.from("{}"), "valid");
  assert.equal(globalThis.__stripe.restaurant.premium, true);
  assert.equal(globalThis.__stripe.restaurant.stripeSubscriptionId, "sub_new");
  assert.equal(globalThis.__stripe.restaurant.stripeCheckoutSessionId, "cs_test_newer");
});