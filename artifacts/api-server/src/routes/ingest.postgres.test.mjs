import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(new URL("../../../../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("manual city import enforces admin, allowlist, lock and independent 12-hour history without publishing", async () => {
  // The service module captures its DB connection at import time. Install only
  // the throwaway cluster URL before importing it; never use inherited secrets.
  const directory = await mkdtemp(path.join(tmpdir(), "manual-osm-pg-"));
  const data = path.join(directory, "data");
  const port = await freePort();
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  };
  const originalFetch = globalThis.fetch;
  let started = false;
  let pool, servicePool, server;
  const routeErrors = [];
  let releaseFirst, firstRequested;
  const firstRequest = new Promise((resolve) => { firstRequested = resolve; });
  const blockedFirst = new Promise((resolve) => { releaseFirst = resolve; });
  const osmCities = [];
  let blockFirst = true;
  let failNext = false;
  try {
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "osm_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${port}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;
    delete process.env.NEON_DATABASE_URL;
    process.env.DATABASE_URL = `postgres://osm_test@127.0.0.1:${port}/postgres`;
    process.env.NODE_ENV = "production";
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`
      CREATE TABLE external_ingestion_schedule (
        id text PRIMARY KEY, last_run_at timestamptz NOT NULL
      );
      CREATE TABLE external_candidates (
        source_id text NOT NULL, source_name text NOT NULL, raw_name text NOT NULL,
        raw_address text, raw_lat double precision, raw_lon double precision,
        raw_phone text, raw_website text, source_flags text[] NOT NULL,
        imported_at timestamptz NOT NULL, verification_status text NOT NULL DEFAULT 'unverified',
        PRIMARY KEY (source_name, source_id)
      );
      CREATE TABLE osm_candidate_workflows (
        source_name text NOT NULL, source_id text NOT NULL,
        state text NOT NULL DEFAULT 'unverified',
        reviewed boolean NOT NULL DEFAULT false, claimed boolean NOT NULL DEFAULT false,
        identity_verified boolean NOT NULL DEFAULT false, rights_confirmed boolean NOT NULL DEFAULT false,
        published boolean NOT NULL DEFAULT false, suppressed boolean NOT NULL DEFAULT false,
        suppressed_at timestamptz, suppressed_reason text, suppressed_by text,
        outreach_blocked boolean NOT NULL DEFAULT false, high_confidence boolean NOT NULL DEFAULT false,
        invite_count integer NOT NULL DEFAULT 0, reviewed_at timestamptz,
        owner_draft jsonb NOT NULL, restaurant_place_id text, activated_at timestamptz,
        owner_outreach_disabled boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (source_name, source_id),
        FOREIGN KEY (source_name, source_id) REFERENCES external_candidates(source_name, source_id)
      );
      INSERT INTO external_ingestion_schedule (id, last_run_at)
        VALUES ('external_ingestion_last_run', '2026-01-01T00:00:00Z');
    `);
    await pool.query(readFileSync(new URL("../../../../lib/db/migrations/0041_external_ingestion_lease.sql", import.meta.url), "utf8"));

    globalThis.fetch = async (url, init) => {
      if (String(url) === "https://overpass-api.de/api/interpreter" && init?.method === "POST") {
        const body = new URLSearchParams(init.body);
        // The mock never contacts OSM; the bounding box differentiates the two allowed cities.
        const query = body.get("data");
        const city = query.includes("51.43") ? "Cardiff" : query.includes("51.45") ? "London" : null;
        assert.ok(city, `Unexpected OSM bounding box: ${query}`);
        osmCities.push(city);
        if (blockFirst) {
          blockFirst = false;
          firstRequested();
          await blockedFirst;
        }
        if (failNext) {
          failNext = false;
          return new Response("upstream unavailable", { status: 503 });
        }
        return Response.json({ elements: [{
          type: "node", id: city === "Cardiff" ? 101 : 102,
          tags: { name: `${city} test kitchen` },
        }] });
      }
      // Advisory cluster probes must not contact the network either.
      if (init?.method === "HEAD") return new Response(null, { status: 503 });
      throw new Error(`Unexpected external request: ${url}`);
    };

    const { pool: actualPool } = await import("@workspace/db");
    servicePool = actualPool;
    const { runExternalIngestionIfDue } = await import("../cron/scheduler.ts");
    const { acquireIngestionLease, IngestionLeaseLost } = await import("../ingestion/lease.ts");
    const { default: router } = await import("./ingest.ts");
    const { routingStatus } = await import("../external/globalRouter.ts");
    const beforeRouting = routingStatus();
    const { default: express } = await import("express");
    const app = express();
    // Session injection is test-only; the real adminOnly middleware still runs.
    app.use((req, _res, next) => {
      req.session = { admin: req.headers["x-test-admin"] === "yes" };
      req.log = { info() {}, error({ err }) { routeErrors.push(err); } };
      next();
    });
    app.use("/dashboard/ingest", router);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function post(query, signed = true) {
      const response = await originalFetch(`${base}/dashboard/ingest${query}`, {
        method: "POST", headers: signed ? { "x-test-admin": "yes" } : {},
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    }

    assert.equal((await post("?region=eu&city=Cardiff", false)).status, 401);
    assert.equal((await post("?region=eu&city=Manchester")).status, 403);
    assert.equal((await post("?region=eu&city=Paris")).status, 403);
    assert.equal((await post("?region=us&city=Cardiff")).status, 400);
    assert.equal((await post("?region=eu&city=London", false)).status, 401);
    assert.equal((await post("?region=bad&city=Cardiff")).status, 400);
    assert.deepEqual(osmCities, []);

    const first = post("?region=eu&city=%20CaRdIfF%20");
    await firstRequest;
    // The lease excludes other processes without holding an idle transaction over OSM.
    assert.equal((await pool.query(
      `SELECT count(*)::int AS count FROM pg_stat_activity
       WHERE datname = current_database() AND state = 'idle in transaction'`,
    )).rows[0].count, 0);
    const racing = await post("?region=eu&city=Cardiff");
    assert.equal(racing.status, 409);
    await runExternalIngestionIfDue(new Date());
    assert.deepEqual(osmCities, ["Cardiff"]);
    assert.match(racing.body.error, /already in progress/);
    assert.deepEqual(osmCities, ["Cardiff"]);
    releaseFirst();
    const completed = await first;
    assert.equal(completed.status, 200, routeErrors.map(String).join("\n"));
    assert.equal(completed.body.execution, "local");
    assert.equal(completed.body.ingestRegion, "local");
    assert.deepEqual(completed.body.result, {
      status: "completed", city: "Cardiff", candidatesFetched: 1, verificationStatus: "unverified",
    });
    const cardiffRun = (await pool.query(
      "SELECT last_run_at FROM external_ingestion_schedule WHERE id = 'manual_city_ingestion:cardiff'",
    )).rows[0].last_run_at;
    const repeat = await post("?region=eu&city=Cardiff");
    assert.equal(repeat.status, 409);
    assert.ok(Number(repeat.headers.get("retry-after")) > 0);
    assert.equal(repeat.body.nextAllowed, cardiffRun.getTime() + 12 * 60 * 60 * 1000);
    assert.deepEqual(osmCities, ["Cardiff"]);

    // A different permitted city has its own history, not Cardiff's cooldown.
    const london = await post("?region=eu&city=London");
    assert.equal(london.status, 200);
    assert.equal(london.body.result.city, "London");
    assert.deepEqual(osmCities, ["Cardiff", "London"]);
    assert.equal((await post("?region=eu&city=London")).status, 409);

    // A crashed worker's lease can be taken over; its stale write is fenced.
    const stale = await acquireIngestionLease();
    assert.ok(stale);
    await pool.query("UPDATE external_ingestion_lease SET expires_at = clock_timestamp() - interval '1 second'");
    const successor = await acquireIngestionLease();
    assert.ok(successor);
    await assert.rejects(stale.commit(async () => {
      throw new Error("stale writer reached database");
    }), IngestionLeaseLost);
    await stale.release();
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM external_ingestion_lease")).rows[0].count, 1);
    await successor.release();

    // A failed import cannot advance its city window.
    await pool.query(
      "UPDATE external_ingestion_schedule SET last_run_at = $1 WHERE id = 'manual_city_ingestion:cardiff'",
      [new Date(Date.now() - 12 * 60 * 60 * 1000 - 60_000)],
    );
    failNext = true;
    assert.equal((await post("?region=eu&city=Cardiff")).status, 503);
    assert.equal((await pool.query(
      "SELECT last_run_at FROM external_ingestion_schedule WHERE id = 'manual_city_ingestion:cardiff'",
    )).rows[0].last_run_at.getTime() < cardiffRun.getTime(), true);
    assert.equal((await post("?region=eu&city=Cardiff")).status, 200);

    const schedule = (await pool.query(
      "SELECT id, last_run_at FROM external_ingestion_schedule ORDER BY id",
    )).rows;
    assert.deepEqual(schedule.map((row) => row.id), [
      "external_ingestion_last_run", "manual_city_ingestion:cardiff", "manual_city_ingestion:london",
    ]);
    assert.equal(schedule[0].last_run_at.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.deepEqual(routingStatus(), beforeRouting);
    const candidates = (await pool.query(
      "SELECT source_id, verification_status FROM external_candidates ORDER BY source_id",
    )).rows;
    assert.deepEqual(candidates, [
      { source_id: "osm:node:101", verification_status: "unverified" },
      { source_id: "osm:node:102", verification_status: "unverified" },
    ]);
    const workflows = (await pool.query(
      `SELECT state, reviewed, claimed, identity_verified, rights_confirmed,
              published, outreach_blocked, owner_outreach_disabled
       FROM osm_candidate_workflows ORDER BY source_id`,
    )).rows;
    assert.equal(workflows.length, 2);
    for (const workflow of workflows) {
      assert.deepEqual(workflow, {
        state: "unverified", reviewed: false, claimed: false, identity_verified: false,
        rights_confirmed: false, published: false, outreach_blocked: false,
        owner_outreach_disabled: false,
      });
    }
  } finally {
    releaseFirst?.();
    globalThis.fetch = originalFetch;
    if (server) await new Promise((resolve) => server.close(resolve));
    await servicePool?.end();
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});