import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
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

test("candidate review decisions and re-imports remain private, isolated and race-safe", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "candidate-review-pg-"));
  const data = path.join(directory, "data");
  const pgPort = await freePort();
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
  };
  const originalFetch = globalThis.fetch;
  let started = false;
  let pool, servicePool, server;
  const routeErrors = [];
  try {
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "candidate_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${pgPort}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;
    delete process.env.NEON_DATABASE_URL;
    process.env.DATABASE_URL = `postgres://candidate_test@127.0.0.1:${pgPort}/postgres`;
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`
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
    `);
    const { pool: actualPool } = await import("@workspace/db");
    servicePool = actualPool;
    const { storeExternalCandidates } = await import("../external/candidateStore.ts");
    const { default: router } = await import("./candidateReview.ts");
    const { default: express } = await import("express");
    const app = express();
    app.use((req, _res, next) => {
      req.session = { admin: req.headers["x-test-admin"] === "yes" };
      req.log = { info() {}, error({ err }) { routeErrors.push(err); } };
      next();
    });
    app.use("/dashboard", router);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    globalThis.fetch = (url, init) => {
      if (!String(url).startsWith(`${base}/`)) {
        throw new Error(`External network request forbidden in candidate review test: ${url}`);
      }
      return originalFetch(url, init);
    };
    async function post(id, action, admin = true) {
      const response = await fetch(`${base}/dashboard/candidates/${encodeURIComponent(id)}/${action}`, {
        method: "POST", headers: admin ? { "x-test-admin": "yes" } : {},
      });
      return { status: response.status, body: await response.json(),
        cacheControl: response.headers.get("cache-control") };
    }
    async function status(sourceName, sourceId) {
      return (await pool.query(
        "SELECT verification_status FROM external_candidates WHERE source_name = $1 AND source_id = $2",
        [sourceName, sourceId],
      )).rows[0]?.verification_status;
    }
    async function concurrentPosts(id, actions) {
      const lock = await pool.connect();
      let requests;
      try {
        await lock.query("BEGIN");
        await lock.query(
          "SELECT 1 FROM external_candidates WHERE source_name = 'FSA' AND source_id = $1 FOR UPDATE",
          [id],
        );
        requests = actions.map((action) => post(id, action));
        // Both handlers read the old status before either conditional UPDATE.
        // Force the updates to overlap rather than merely firing HTTP calls together.
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const result = await pool.query(`
            SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
              AND query ILIKE '%external_candidates%'
          `);
          if (result.rows[0].n >= actions.length) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.ok(waiting, "both review updates must wait on the same candidate row");
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
      }
      return Promise.all(requests);
    }
    const now = new Date("2026-09-25T00:00:00Z");
    const candidate = (id, sourceName = "FSA", complete = true) => ({
      sourceId: id, sourceName, rawName: "London Cafe",
      rawAddress: complete ? "10 High Street" : null,
      rawCoords: complete ? { lat: 51.5, lon: -0.1 } : null,
      rawPhone: complete ? "+442079460958" : null,
      rawWebsite: complete ? "https://londoncafe.example" : null,
      sourceFlags: ["licensed"], importedAt: now.toISOString(),
    });
    const importCandidates = (...items) => storeExternalCandidates(items, now);

    await importCandidates(candidate("verify"), candidate("reject"), candidate("override"),
      candidate("race"), candidate("same"), candidate("ambiguous"),
      candidate("ambiguous", "NYC"), candidate("osm:node:11", "OSM"),
      candidate("needs-scoring", "FSA", false));
    assert.equal(await status("FSA", "verify"), "review_ready");
    assert.equal(await status("FSA", "needs-scoring"), "unverified");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM osm_candidate_workflows")).rows[0].n, 1);

    for (const action of ["verify", "reject"]) {
      const denied = await post("verify", action, false);
      assert.equal(denied.status, 401);
      assert.equal(denied.body.error, "Admin login required");
      assert.equal(denied.cacheControl, "no-store");
      assert.equal((await post("missing", action)).status, 404);
      assert.deepEqual((await post("ambiguous", action)).body, { error: "candidate_source_id_ambiguous" });
      assert.equal((await post("ambiguous", action)).status, 409);
      assert.equal((await post("osm:node:11", action)).status, 409);
    }
    assert.equal((await post(" verify ", "verify")).status, 400);
    assert.equal((await post("x".repeat(513), "reject")).status, 400);
    assert.equal(await status("FSA", "verify"), "review_ready");
    assert.equal(await status("FSA", "ambiguous"), "review_ready");
    assert.equal(await status("NYC", "ambiguous"), "review_ready");
    assert.equal(await status("OSM", "osm:node:11"), "review_ready");
    assert.deepEqual((await pool.query(
      "SELECT state, reviewed, published, suppressed FROM osm_candidate_workflows WHERE source_id = 'osm:node:11'",
    )).rows[0], { state: "unverified", reviewed: false, published: false, suppressed: false });

    const verified = await post("verify", "verify");
    assert.equal(verified.status, 200);
    assert.deepEqual(verified.body, {
      status: "verified_pending_publication", candidateId: "verify", sourceName: "FSA",
      verificationStatus: "verified", changed: true,
    });
    assert.equal((await post("verify", "verify")).body.changed, false);
    assert.equal(await status("FSA", "verify"), "verified");
    const rejected = await post("reject", "reject");
    assert.equal(rejected.status, 200);
    assert.deepEqual(rejected.body, {
      status: "suppressed_permanently", candidateId: "reject", sourceName: "FSA",
      verificationStatus: "rejected", changed: true,
    });
    assert.equal((await post("reject", "reject")).body.changed, false);
    assert.deepEqual((await post("reject", "verify")).body, { error: "candidate_review_conflict" });
    assert.equal((await post("reject", "verify")).status, 409);
    await pool.query("UPDATE external_candidates SET verification_status = 'promoted' WHERE source_id = 'override'");
    assert.equal((await post("override", "reject")).status, 409);
    assert.equal((await post("override", "verify")).status, 409);
    assert.equal(await status("FSA", "override"), "promoted");

    // Reject is allowed to override a prior internal verification.
    assert.equal((await post("verify", "reject")).body.changed, true);
    assert.equal((await post("verify", "reject")).body.changed, false);
    assert.equal((await post("verify", "verify")).status, 409);
    assert.equal(await status("FSA", "verify"), "rejected");

    // Simultaneous requests must not both report a state change. A reject
    // wins over verify regardless of which update gets the row lock first.
    const same = await concurrentPosts("same", ["verify", "verify"]);
    assert.deepEqual(same.map((result) => result.status), [200, 200]);
    assert.deepEqual(same.map((result) => result.body.changed).sort(), [false, true]);
    assert.equal(await status("FSA", "same"), "verified");
    const race = await concurrentPosts("race", ["verify", "reject"]);
    assert.equal(race[1].status, 200);
    assert.ok([200, 409].includes(race[0].status));
    assert.equal(await status("FSA", "race"), "rejected");
    assert.equal((await post("race", "verify")).status, 409);

    // Re-importing cannot reset a rejection even if the source changes its
    // completeness; scoring only queues review and never creates publication.
    await importCandidates(candidate("reject", "FSA", false), candidate("verify"),
      candidate("needs-scoring"), candidate("osm:node:11", "OSM"));
    assert.equal(await status("FSA", "reject"), "rejected");
    assert.equal(await status("FSA", "verify"), "rejected");
    await importCandidates(candidate("needs-scoring"));
    assert.equal(await status("FSA", "needs-scoring"), "review_ready");
    assert.equal((await pool.query(
      "SELECT count(*)::int AS n FROM external_candidates WHERE source_id = 'needs-scoring'",
    )).rows[0].n, 1);
    assert.deepEqual((await pool.query(
      "SELECT state, reviewed, published, suppressed FROM osm_candidate_workflows WHERE source_id = 'osm:node:11'",
    )).rows[0], { state: "unverified", reviewed: false, published: false, suppressed: false });
    assert.deepEqual(routeErrors, []);
  } finally {
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