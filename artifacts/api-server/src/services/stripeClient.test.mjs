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
};
await Promise.all([
  writeFile(stubs.stripe, `export default class Stripe {
    constructor(key) { this.key = key; }
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
  writeFile(stubs.price, `export const getPremiumPriceId = () => "price_test";
    export const stripeKeyLivemode = () => false;`),
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
};
after(() => {
  globalThis.fetch = original.fetch;
  Date.now = original.now;
  for (const [key, value] of [
    ["STRIPE_SECRET_KEY", original.key],
    ["REPLIT_CONNECTORS_HOSTNAME", original.host],
    ["REPL_IDENTITY", original.identity],
    ["REPLIT_DEV_DOMAIN", original.domain],
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
let now = 1_000_000;
Date.now = () => now;

const { getUncachableStripeClient, getStripeSync, verifyStripeEvent } =
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