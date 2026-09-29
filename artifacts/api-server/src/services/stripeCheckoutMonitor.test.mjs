import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const dir = await mkdtemp(path.join(os.tmpdir(), "stripe-alert-test-"));
after(() => rm(dir, { recursive: true, force: true }));
const file = name => path.join(dir, name);
await Promise.all([
  writeFile(file("orm.mjs"), `
    export const eq = (c, value) => ({ op: "eq", c, value });
    export const gt = (c, value) => ({ op: "gt", c, value });
    export const and = (...conditions) => ({ op: "and", conditions });
    export const isNull = c => ({ op: "null", c });
    export const isNotNull = c => ({ op: "notNull", c });
    export const asc = c => c;
  `),
  writeFile(file("logger.mjs"), `export const logger = {
    error: (...args) => globalThis.alertLogs.push(["error", ...args]),
    info: (...args) => globalThis.alertLogs.push(["info", ...args]),
  };`),
  writeFile(file("client.mjs"), `export const getPremiumStripeClient = async () => ({
    livemode: false,
    stripe: {
      checkout: { sessions: { retrieve: async () => globalThis.session } },
      subscriptions: { retrieve: async () => globalThis.subscription },
    },
  });`),
  writeFile(file("service.mjs"), `export const assertPremiumSubscription = (session, subscription) => {
    if (subscription.status !== "active" || subscription.id !== session.subscription ||
        subscription.customer !== session.customer) throw new Error("Invalid subscription");
  };`),
  writeFile(file("db.mjs"), `
    const table = (name, columns) => Object.assign({ __table: name },
      Object.fromEntries(columns.map(c => [c, { key: c }])));
    export const restaurantsTable = table("restaurant", [
      "placeId", "name", "claimStatus", "claimEmail", "stripeCustomerId",
      "stripeSubscriptionId", "stripeCheckoutSessionId", "premium",
    ]);
    export const stripeCheckoutAlertsTable = table("alert", [
      "sessionId", "restaurantId", "customerId", "subscriptionId",
      "createdAt", "paidObservedAt", "alertedAt", "resolvedAt",
    ]);
    const match = (p, row) => !p || (p.op === "and"
      ? p.conditions.every(c => match(c, row))
      : p.op === "eq" ? row[p.c.key] === p.value
      : p.op === "gt" ? row[p.c.key] > p.value
      : p.op === "null" ? row[p.c.key] == null
      : row[p.c.key] != null);
    const select = selection => ({
      from(table) {
        let where, order, joined = false;
        const query = {
          leftJoin() { joined = true; return query; },
          where(p) { where = p; return query; },
          orderBy(c) { order = c.key; return query; },
          limit(count) {
            const rows = table.__table === "restaurant"
              ? [globalThis.restaurant] : Object.values(globalThis.alerts);
            return rows.filter(row => match(where, row))
              .sort((a,b) => order ? String(a[order]).localeCompare(String(b[order])) : 0)
              .slice(0, count).map(row => selection
                ? Object.fromEntries(Object.entries(selection).map(([key, col]) =>
                    [key, joined && key === "restaurantName"
                      ? globalThis.restaurant.name : row[col.key]]))
                : { ...row });
          },
        };
        return query;
      },
    });
    export const db = {
      select,
      insert() { return { values(row) { return { onConflictDoNothing() {
        globalThis.alerts[row.sessionId] ??= {
          ...row, subscriptionId: null, createdAt: new Date(),
          paidObservedAt: null, alertedAt: null, resolvedAt: null,
        };
        return Promise.resolve();
      } }; } }; },
      update() { return { set(values) { return { where(p) {
        const row = Object.values(globalThis.alerts).find(r => match(p,r));
        const run = () => { if (!row) return []; Object.assign(row, values); return [row]; };
        return {
          then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
          returning(selection) { return Promise.resolve(run().map(r =>
            Object.fromEntries(Object.entries(selection).map(([k,c]) => [k,r[c.key]])))); },
        };
      } }; } }; },
    };
  `),
]);
const output = file("monitor.mjs");
await build({
  entryPoints: [path.resolve(import.meta.dirname, "stripeCheckoutMonitor.ts")],
  outfile: output, bundle: true, platform: "node", format: "esm",
  plugins: [{
    name: "mocks",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: file("db.mjs") }));
      builder.onResolve({ filter: /^drizzle-orm$/ }, () => ({ path: file("orm.mjs") }));
      builder.onResolve({ filter: /lib\/logger$/ }, () => ({ path: file("logger.mjs") }));
      builder.onResolve({ filter: /stripeClient$/ }, () => ({ path: file("client.mjs") }));
      builder.onResolve({ filter: /stripeService$/ }, () => ({ path: file("service.mjs") }));
    },
  }],
});
const { checkPaidCheckoutAlerts, listPaidCheckoutAlerts } =
  await import(pathToFileURL(output).href);

function setup() {
  globalThis.alertLogs = [];
  globalThis.alerts = {};
  globalThis.restaurant = {
    placeId: "rest_1", name: "Restaurant", claimStatus: "basic",
    claimEmail: "private@example.test", stripeCustomerId: "cus_1",
    stripeSubscriptionId: null, stripeCheckoutSessionId: "cs_1", premium: false,
  };
  globalThis.session = {
    status: "open", payment_status: "unpaid", livemode: false,
    mode: "subscription", customer: "cus_1",
    subscription: "sub_1", metadata: { restaurantId: "rest_1" },
  };
  globalThis.subscription = { id: "sub_1", customer: "cus_1", status: "active" };
}

test("only Stripe-confirmed paid sessions alert after delay, once, and resolve on matching entitlement", async () => {
  setup();
  const start = new Date("2026-09-29T12:00:00Z");
  await checkPaidCheckoutAlerts(start);
  assert.deepEqual(Object.keys(globalThis.alerts), ["cs_1"]);
  assert.equal((await listPaidCheckoutAlerts()).length, 0);
  globalThis.session.status = "complete";
  globalThis.session.payment_status = "paid";
  await checkPaidCheckoutAlerts(start);
  assert.equal(globalThis.alerts.cs_1.paidObservedAt.toISOString(), start.toISOString());
  await checkPaidCheckoutAlerts(new Date(start.getTime() + 14 * 60_000));
  assert.equal((await listPaidCheckoutAlerts()).length, 0);
  await checkPaidCheckoutAlerts(new Date(start.getTime() + 16 * 60_000));
  assert.equal((await listPaidCheckoutAlerts()).length, 1);
  assert.equal(globalThis.alertLogs.filter(([level]) => level === "error").length, 1);
  await checkPaidCheckoutAlerts(new Date(start.getTime() + 20 * 60_000));
  assert.equal(globalThis.alertLogs.filter(([level]) => level === "error").length, 1);
  globalThis.restaurant.premium = true;
  globalThis.restaurant.stripeSubscriptionId = "sub_wrong";
  await checkPaidCheckoutAlerts(new Date(start.getTime() + 25 * 60_000));
  assert.equal((await listPaidCheckoutAlerts()).length, 1);
  globalThis.restaurant.stripeSubscriptionId = "sub_1";
  await checkPaidCheckoutAlerts(new Date(start.getTime() + 30 * 60_000));
  assert.equal((await listPaidCheckoutAlerts()).length, 0);
  assert.equal(globalThis.alertLogs.filter(([level]) => level === "info").length, 1);
});

test("a paid checkout with mismatched metadata remains an alert, not an entitlement", async () => {
  setup();
  globalThis.session.status = "complete";
  globalThis.session.payment_status = "paid";
  globalThis.session.metadata.restaurantId = "different";
  await checkPaidCheckoutAlerts(new Date("2026-09-29T12:00:00Z"));
  await checkPaidCheckoutAlerts(new Date("2026-09-29T12:20:00Z"));
  assert.equal((await listPaidCheckoutAlerts()).length, 1);
  assert.equal(globalThis.alertLogs[0][1].mappingValid, false);
  assert.equal(globalThis.restaurant.premium, false);
});