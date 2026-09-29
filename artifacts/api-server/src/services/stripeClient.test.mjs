import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const temp = await mkdtemp(path.join(os.tmpdir(), "stripe-credentials-test-"));
after(() => rm(temp, { recursive: true, force: true }));
const stubs = {
  stripe: path.join(temp, "stripe.mjs"),
  sync: path.join(temp, "sync.mjs"),
  connectors: path.join(temp, "connectors.mjs"),
  price: path.join(temp, "price.mjs"),
  db: path.join(temp, "db.mjs"),
};
await Promise.all([
  writeFile(stubs.stripe, `export default class Stripe {
    constructor(key) { this.key = key; }
    prices = { retrieve: async (id) => {
      globalThis.__retrievedPrices.push(id);
      if (globalThis.__priceError) throw globalThis.__priceError;
      return globalThis.__price;
    } };
    webhooks = { constructEventAsync: async (_body, signature, secret) => {
      globalThis.__verificationSecrets.push(secret);
      if (signature !== "valid") throw { type: "StripeSignatureVerificationError" };
      return { id: "evt_verified" };
    } };
  }`),
  writeFile(stubs.sync, `export class StripeSync {
    constructor(config) {
      this.key = config.stripeSecretKey;
      this.postgresClient = {
        query: async () => ({ rows: [{ secret: "whsec_test" }] }),
        pool: { end: async () => { globalThis.__closedPools += 1; } },
      };
    }
    async getAccountId() { return "acct_test"; }
  }
  export const runMigrations = async () => {};`),
  writeFile(stubs.connectors, `export class ReplitConnectors {}`),
  writeFile(stubs.price, `export const getPremiumPriceId = (live) => live ? "price_live" : "price_test";
    export const stripeKeyLivemode = (key) => key.startsWith("sk_live_");`),
  writeFile(stubs.db, `export const pool = {
    async connect() {
      let unlock;
      return {
        async query(sql) {
          if (sql.includes("pg_advisory_xact_lock")) {
            if (globalThis.__lockFailure) throw new Error("database lock unavailable");
            const previous = globalThis.__lockTail;
            globalThis.__lockTail = new Promise(resolve => { unlock = resolve; });
            await previous;
          }
          if (sql === "COMMIT" || sql === "ROLLBACK") {
            unlock?.();
            unlock = undefined;
          }
          return { rows: [] };
        },
        release() { unlock?.(); },
      };
    },
  };`),
]);
const output = path.join(temp, "client.mjs");
await build({
  entryPoints: [path.resolve(import.meta.dirname, "stripeClient.ts")],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "connector-stubs",
    setup(builder) {
      builder.onResolve({ filter: /^stripe$/ }, () => ({ path: stubs.stripe }));
      builder.onResolve({ filter: /^stripe-replit-sync$/ }, () => ({ path: stubs.sync }));
      builder.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () => ({ path: stubs.connectors }));
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: stubs.db }));
      builder.onResolve({ filter: /lib\/premium-price$/ }, () => ({ path: stubs.price }));
    },
  }],
});

const original = {
  fetch: globalThis.fetch,
  now: Date.now,
  key: process.env.STRIPE_SECRET_KEY,
  host: process.env.REPLIT_CONNECTORS_HOSTNAME,
  identity: process.env.REPL_IDENTITY,
  domain: process.env.REPLIT_DEV_DOMAIN,
  nodeEnv: process.env.NODE_ENV,
  deployment: process.env.REPLIT_DEPLOYMENT,
};
after(() => {
  globalThis.fetch = original.fetch;
  Date.now = original.now;
  for (const [key, value] of [
    ["STRIPE_SECRET_KEY", original.key],
    ["REPLIT_CONNECTORS_HOSTNAME", original.host],
    ["REPL_IDENTITY", original.identity],
    ["REPLIT_DEV_DOMAIN", original.domain],
    ["NODE_ENV", original.nodeEnv],
    ["REPLIT_DEPLOYMENT", original.deployment],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
delete process.env.STRIPE_SECRET_KEY;
process.env.REPLIT_CONNECTORS_HOSTNAME = "https://connector.test";
process.env.REPL_IDENTITY = "test-identity";
process.env.REPLIT_DEV_DOMAIN = "preview.test";
globalThis.__verificationSecrets = [];
globalThis.__closedPools = 0;
globalThis.__lockTail = Promise.resolve();
let now = 1_000_000;
Date.now = () => now;

const { getUncachableStripeClient, getStripeSync, verifyStripeEvent, validatePremiumPrice } =
  await import(pathToFileURL(output).href);
const credentials = (key) => ({
  items: [{ environment: "development", status: "connected",
    settings: { secret_key: key } }],
});

test("a webhook burst shares one credential lookup and still checks each signature", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    return Response.json(credentials("sk_test_first"));
  };
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    i % 2 === 0
      ? getStripeSync().then(sync => sync.postgresClient.pool.end())
      : getUncachableStripeClient().then(client => client.key),
  ));
  assert.equal(calls, 1);
  assert.ok(results.includes("sk_test_first"));
  await assert.rejects(verifyStripeEvent(Buffer.from("{}"), "forged"));
  assert.deepEqual(globalThis.__verificationSecrets, ["whsec_test"]);
  assert.equal(globalThis.__closedPools, 11);
});

test("expired credentials retry a 429, and a failed refresh is not cached", async () => {
  now += 60_001;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(null, { status: 429 });
    return Response.json(credentials("sk_test_rotated"));
  };
  const clients = await Promise.all(Array.from({ length: 15 },
    () => getUncachableStripeClient()));
  assert.equal(calls, 2);
  assert.ok(clients.every(client => client.key === "sk_test_rotated"));

  now += 60_001;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(getUncachableStripeClient(), /503/);
  globalThis.fetch = async () => Response.json(credentials("sk_test_recovered"));
  assert.equal((await getUncachableStripeClient()).key, "sk_test_recovered");
});

test("six independent replicas bound connector concurrency without sharing credentials", async () => {
  const replicas = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    import(`${pathToFileURL(output).href}?replica=${i}`)));
  let calls = 0;
  let active = 0;
  let peak = 0;
  globalThis.fetch = async () => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return Response.json(credentials("sk_test_replica"));
  };
  const burst = () => Promise.all(replicas.flatMap(replica =>
    Array.from({ length: 12 }, () => replica.getUncachableStripeClient())));
  await burst();
  assert.equal(calls, 6, "one request per replica per TTL, not per webhook");
  assert.equal(peak, 1, "connector requests across replicas must not overlap");
  await burst();
  assert.equal(calls, 6);
  now += 60_001;
  let rateLimited = false;
  const successfulFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    if (!rateLimited) {
      rateLimited = true;
      return new Response(null, { status: 429 });
    }
    return successfulFetch(...args);
  };
  await burst();
  assert.equal(calls, 12, "six successful refreshes per minute at six replicas");
  assert.equal(peak, 1);
  assert.ok(rateLimited, "429 retries happen inside the shared lock");

  now += 60_001;
  globalThis.__lockFailure = true;
  let uncoordinatedCalls = 0;
  globalThis.fetch = async () => { uncoordinatedCalls++; return Response.json(credentials("sk_test_unsafe")); };
  await assert.rejects(replicas[0].getUncachableStripeClient(), /database lock unavailable/);
  assert.equal(uncoordinatedCalls, 0, "never bypass coordination on database failure");
  globalThis.__lockFailure = false;
  assert.equal((await replicas[0].getUncachableStripeClient()).key, "sk_test_unsafe");
});

test("release probe reads a live £99 monthly price without creating a checkout", async () => {
  process.env.NODE_ENV = "production";
  process.env.STRIPE_SECRET_KEY = "sk_live_example";
  globalThis.__retrievedPrices = [];
  globalThis.__price = {
    id: "price_live", livemode: true, active: true, currency: "gbp",
    unit_amount: 9900, type: "recurring",
    recurring: { interval: "month", interval_count: 1 },
  };
  try {
    await validatePremiumPrice();
    assert.deepEqual(globalThis.__retrievedPrices, ["price_live"]);
    for (const changed of [
      { id: "price_other" }, { active: false }, { livemode: false }, { currency: "usd" },
      { unit_amount: 9901 }, { type: "one_time" },
      { recurring: { interval: "year", interval_count: 1 } },
      { recurring: { interval: "month", interval_count: 2 } },
    ]) {
      globalThis.__price = { ...globalThis.__price, ...changed };
      await assert.rejects(validatePremiumPrice(), /active £99 GBP monthly/);
      globalThis.__price = {
        id: "price_live", livemode: true, active: true, currency: "gbp",
        unit_amount: 9900, type: "recurring",
        recurring: { interval: "month", interval_count: 1 },
      };
    }
    globalThis.__priceError = new Error("No such price");
    await assert.rejects(validatePremiumPrice(), /No such price/);
    globalThis.__priceError = undefined;
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    await assert.rejects(validatePremiumPrice(), /requires live Stripe credentials/);
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.NODE_ENV;
    delete globalThis.__price;
    delete globalThis.__priceError;
  }
});