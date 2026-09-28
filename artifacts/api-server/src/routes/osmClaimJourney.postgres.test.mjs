import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { getTableColumns } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(new URL("../../../../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// Bundle the actual routers, replacing only the connector transport. The mock
// rejects every operation except the two Gmail calls needed to send a message.
async function bundleRoutes(output) {
  await build({
    stdin: {
      contents: `export { default as admin } from "./osmCandidateWorkflowAdmin.ts";
export { default as owner } from "./osmClaimWorkflowOwner.ts";`,
      resolveDir: here,
      sourcefile: "osm-claim-journey-entry.ts",
      loader: "ts",
    },
    outfile: output,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    plugins: [{
      name: "no-real-mail",
      setup(builder) {
        builder.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () =>
          ({ path: "mail", namespace: "test-mail" }));
        builder.onLoad({ filter: /.*/, namespace: "test-mail" }, () => ({
          loader: "js",
          contents: `
export class ReplitConnectors {
  async proxy(provider, endpoint, options) {
    if (provider !== "google-mail") throw new Error("Unexpected mail provider");
    if (endpoint === "/gmail/v1/users/me/profile") {
      return { ok: true, json: async () => ({ emailAddress: "sender@example.test" }) };
    }
    if (endpoint !== "/gmail/v1/users/me/messages/send" || options?.method !== "POST") {
      throw new Error("Unexpected mail request: " + endpoint);
    }
    const raw = JSON.parse(options.body).raw;
    globalThis.__osmTestMail.push(Buffer.from(raw, "base64url").toString("utf8"));
    return { ok: true, json: async () => ({ id: "test-message", threadId: "test-thread" }) };
  }
}`,
        }));
      },
    }],
    logLevel: "silent",
  });
}

test("OSM review, single-use claim, inbox proof, evidence gates and private-to-public activation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "osm-claim-journey-"));
  const data = path.join(directory, "data");
  // Resolve dependencies from this package, not /tmp.
  const bundle = path.join(here, "../../node_modules/.osm-claim-journey-test.mjs");
  const old = Object.fromEntries(["DATABASE_URL", "NEON_DATABASE_URL", "NODE_ENV",
    "OSM_CLAIM_AUTO_INVITES_ENABLED"].map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const errors = [];
  let started = false;
  let pool, servicePool, server;
  try {
    const port = await freePort();
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "claim_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${port}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;
    delete process.env.NEON_DATABASE_URL;
    delete process.env.OSM_CLAIM_AUTO_INVITES_ENABLED;
    process.env.DATABASE_URL = `postgres://claim_test@127.0.0.1:${port}/postgres`;
    // The real invitation route intentionally requires production mode. The
    // disposable DB and connector mock are installed before importing it.
    process.env.NODE_ENV = "production";
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { restaurantsTable, pool: actualPool } = await import("@workspace/db");
    servicePool = actualPool;
    const columns = Object.values(getTableColumns(restaurantsTable)).map((column) => {
      const defaults = {
        source_name: "'google'", published: "true", currency: "'GBP'",
        types: "'{}'::text[]", cuisine_tags: "'{}'::text[]", dietary_tags: "'{}'::text[]",
        enrichment_status: "'pending'", imported_at: "now()", outreach_status: "'pending'",
        outreach_count: "0", opening_hours: "'{}'::text[]",
        delivery_platforms: "'{}'::text[]", social_links: "'{}'::jsonb",
        popularity: "0", ranking_score: "0", stripe_checkout_attempt: "0", premium: "false",
      };
      return `"${column.name}" ${column.getSQLType()}${column.name === "place_id" ? " PRIMARY KEY" : ""}` +
        (defaults[column.name] ? ` DEFAULT ${defaults[column.name]}` : "");
    });
    await pool.query(`CREATE TABLE restaurants (${columns.join(", ")}); CREATE TABLE external_candidates (
      source_id text NOT NULL, source_name text NOT NULL, raw_name text NOT NULL,
      raw_address text, raw_lat double precision, raw_lon double precision,
      raw_phone text, raw_website text, source_flags text[] NOT NULL,
      imported_at timestamptz NOT NULL, verification_status text NOT NULL DEFAULT 'unverified',
      PRIMARY KEY (source_name, source_id)
    );`);
    await pool.query(await readFile(new URL("../../../../lib/db/migrations/0030_osm_candidate_claim_workflow.sql", import.meta.url), "utf8"));
    await pool.query(await readFile(new URL("../../../../lib/db/migrations/0042_osm_automatic_claim_invites.sql", import.meta.url), "utf8"));

    globalThis.__osmTestMail = [];
    await bundleRoutes(bundle);
    const { admin, owner } = await import(pathToFileURL(bundle).href);
    const { default: search } = await import("./search.ts");
    const { default: express } = await import("express");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { admin: req.get("x-test-admin") === "yes" };
      req.log = { info() {}, warn() {}, error({ err }) { errors.push(err); } };
      next();
    });
    app.use("/api", admin, owner, search);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    globalThis.fetch = (url, options) => {
      if (!String(url).startsWith(`${base}/`)) throw new Error(`External network forbidden: ${url}`);
      return originalFetch(url, options);
    };
    async function request(method, route, body, { adminAccess = false, token } = {}) {
      const response = await fetch(`${base}/api${route}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(adminAccess ? { "x-test-admin": "yes" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    }
    const adminPost = (id, action, body) =>
      request("POST", `/dashboard/osm-candidates/OSM/${encodeURIComponent(id)}/${action}`, body, { adminAccess: true });
    async function candidate(id) {
      const draft = {
        name: `Test kitchen ${id}`, address: "10 Test Street", city: null,
        phone: null, website: null, description: null, openingHours: [],
        latitude: 51.5, longitude: -0.1,
      };
      await pool.query(`INSERT INTO external_candidates
        (source_name, source_id, raw_name, raw_address, raw_lat, raw_lon, source_flags, imported_at, verification_status)
        VALUES ('OSM', $1, $2, $3, 51.5, -0.1, '{}', now(), 'review_ready')`,
      [id, draft.name, draft.address]);
      await pool.query(`INSERT INTO osm_candidate_workflows
        (source_name, source_id, high_confidence, owner_draft)
        VALUES ('OSM', $1, true, $2)`, [id, JSON.stringify(draft)]);
    }
    async function invite(id) {
      return adminPost(id, "invites", { method: "email", sentTo: "claimant@example.test" });
    }
    const mailToken = (message) => {
      const match = message.match(/https:\/\/www\.thefoodadvisor\.co\.uk\/claim\/[^/\s]+\/([A-Za-z0-9_-]+)/);
      assert.ok(match, "invitation mail contains a one-use token");
      return match[1];
    };
    const listing = (id) => pool.query(
      "SELECT place_id, published, source_attribution FROM restaurants WHERE source_name = 'OSM' AND source_id = $1",
      [id],
    ).then((result) => result.rows);
    const searchName = async (id) => {
      const result = await request("GET", `/search?q=${encodeURIComponent(`Test kitchen ${id}`)}`);
      assert.equal(result.status, 200, JSON.stringify(result));
      return result.body.results.filter((item) => item.name === `Test kitchen ${id}`);
    };

    await candidate("node:101");
    assert.equal((await invite("node:101")).status, 409, "unreviewed candidates cannot be invited");
    assert.equal(globalThis.__osmTestMail.length, 0);
    assert.equal((await adminPost("node:101", "review")).status, 200);
    assert.equal((await request("POST", "/dashboard/osm-candidates/OSM/node%3A101/invites",
      { method: "email", sentTo: "claimant@example.test" })).status, 401);
    const sent = await invite("node:101");
    assert.equal(sent.status, 201, JSON.stringify(sent));
    assert.equal(globalThis.__osmTestMail.length, 1);
    assert.match(globalThis.__osmTestMail[0], /To: claimant@example\.test/);
    const claimToken = mailToken(globalThis.__osmTestMail[0]);
    assert.notEqual((await pool.query(
      "SELECT token_hash FROM osm_claim_invites WHERE source_id = 'node:101'",
    )).rows[0].token_hash, claimToken, "only a token hash is stored");
    assert.equal((await invite("node:101")).status, 409, "invite cooldown prevents duplicate mail");
    assert.equal((await adminPost("node:101", "evidence/decision",
      { kind: "ownership", decision: "approved" })).status, 409);
    const exchange = await request("POST", "/claim/exchange", { claimToken });
    assert.equal(exchange.status, 200, JSON.stringify(exchange));
    const token = exchange.body.ownerSession;
    assert.ok(token.length >= 32);
    assert.equal((await request("POST", "/claim/exchange", { claimToken })).status, 400);
    assert.equal((await pool.query(
      "SELECT status, used_at IS NOT NULL AS consumed FROM osm_claim_invites WHERE source_id = 'node:101'",
    )).rows[0].status, "used");
    assert.equal((await request("POST", "/owner/claim/activate", {}, { token })).status, 409);
    assert.equal((await request("POST", "/claim/verification-code/request", {}, { token })).status, 202);
    assert.match(globalThis.__osmTestMail[1], /To: claimant@example\.test/);
    const code = globalThis.__osmTestMail[1].match(/\r\n([0-9]{8})\r\n/);
    assert.ok(code, "verification code is sent only to the mock inbox");
    assert.notEqual((await pool.query("SELECT code_hash FROM osm_verification_codes")).rows[0].code_hash, code[1]);
    assert.equal((await request("POST", "/claim/verification-code/submit", { code: "000000" }, { token })).status, 400);
    assert.equal((await request("POST", "/claim/verification-code/submit", { code: code[1] }, { token })).status, 200);
    assert.equal((await request("POST", "/claim/verification-code/submit", { code: code[1] }, { token })).status, 400);
    assert.equal((await listing("node:101")).length, 1, "inbox proof creates a private draft");
    assert.equal((await listing("node:101"))[0].published, false);
    assert.deepEqual(await searchName("node:101"), [], "private draft is excluded from public search");
    assert.equal((await request("POST", "/owner/claim/activate", {}, { token })).status, 409);
    assert.equal((await request("PATCH", "/owner/claim/draft", { city: "Cardiff" }, { token })).status, 200);
    const evidence = {
      ownershipDescription: "Business ownership document submitted for review",
      rightsDescription: "OpenStreetMap source and licence reviewed for this listing",
      sourceAttribution: "© OpenStreetMap contributors",
    };
    assert.equal((await request("PUT", "/claim/evidence", evidence, { token })).status, 200);
    assert.equal((await request("POST", "/owner/claim/activate", {}, { token })).status, 409);
    const decide = (kind) => adminPost("node:101", "evidence/decision", { kind, decision: "approved" });
    assert.equal((await decide("ownership")).status, 200);
    assert.equal((await request("POST", "/owner/claim/activate", {}, { token })).status, 409,
      "one approval cannot publish");
    assert.deepEqual(await searchName("node:101"), []);
    assert.equal((await decide("source_rights")).status, 200);
    assert.equal((await decide("source_rights")).status, 409, "review decisions cannot be replayed");
    assert.equal((await request("PATCH", "/owner/claim/draft", { name: "Unreviewed edit" }, { token })).status, 409);
    const simultaneousActivations = await Promise.all([
      request("POST", "/owner/claim/activate", {}, { token }),
      request("POST", "/owner/claim/activate", {}, { token }),
    ]);
    assert.ok(simultaneousActivations.some((result) => result.status === 200 && result.body.published),
      JSON.stringify({ simultaneousActivations, errors }));
    assert.ok(simultaneousActivations.every((result) => [200, 503].includes(result.status)),
      JSON.stringify(simultaneousActivations));
    assert.equal((await request("POST", "/owner/claim/activate", {}, { token })).status, 200);
    assert.equal((await listing("node:101")).length, 1);
    assert.equal((await listing("node:101"))[0].published, true);
    assert.match((await listing("node:101"))[0].source_attribution, /OpenStreetMap/);
    assert.equal((await searchName("node:101")).length, 1);
    assert.equal((await adminPost("node:101", "reject", { reason: "too late" })).status, 409);

    // Suppression revokes both unopened invitations and already-issued sessions.
    await candidate("node:102");
    await adminPost("node:102", "review");
    assert.equal((await invite("node:102")).status, 201);
    const unused = mailToken(globalThis.__osmTestMail.at(-1));
    assert.equal((await adminPost("node:102", "reject", { reason: "bad source" })).status, 200);
    assert.equal((await request("POST", "/claim/exchange", { claimToken: unused })).status, 400);
    assert.equal((await invite("node:102")).status, 409);
    assert.deepEqual(await listing("node:102"), []);
    await candidate("node:103");
    await adminPost("node:103", "review");
    assert.equal((await invite("node:103")).status, 201);
    const claimed = await request("POST", "/claim/exchange", { claimToken: mailToken(globalThis.__osmTestMail.at(-1)) });
    assert.equal(claimed.status, 200);
    assert.equal((await adminPost("node:103", "reject", { reason: "claim rejected" })).status, 200);
    assert.equal((await request("GET", "/owner/claim/dashboard", undefined, { token: claimed.body.ownerSession })).status, 401);
    assert.deepEqual(await searchName("node:103"), []);

    await candidate("node:104");
    await adminPost("node:104", "review");
    const before = globalThis.__osmTestMail.length;
    const concurrentInvites = await Promise.all([invite("node:104"), invite("node:104")]);
    assert.deepEqual(concurrentInvites.map((item) => item.status).sort(), [201, 409]);
    assert.equal(globalThis.__osmTestMail.length, before + 1);
    const raceToken = mailToken(globalThis.__osmTestMail.at(-1));
    const exchanges = await Promise.all([
      request("POST", "/claim/exchange", { claimToken: raceToken }),
      request("POST", "/claim/exchange", { claimToken: raceToken }),
    ]);
    assert.deepEqual(exchanges.map((item) => item.status).sort((a, b) => a - b), [200, 400]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM osm_owner_sessions WHERE source_id = 'node:104'")).rows[0].n, 1);
    assert.deepEqual(await listing("node:104"), []);
    assert.deepEqual(errors, []);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__osmTestMail;
    if (server) await new Promise((resolve) => server.close(resolve));
    await servicePool?.end();
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(bundle, { force: true });
    await rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});