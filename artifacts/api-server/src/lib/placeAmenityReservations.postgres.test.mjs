import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migrations = fileURLToPath(new URL("../../../../lib/db/migrations/", import.meta.url));
const options = {
  monthlyBudgetCents: 160, estimatedRequestCents: 80,
  dailyLimit: 10, providerMinuteQuota: 10, maxRequests: 5,
};

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForBlockedClaims(pool) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const result = await pool.query(`
      SELECT count(*)::integer AS count FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
        AND query LIKE '%FROM crawler_progress WHERE id = 1 FOR UPDATE%'
    `);
    if (result.rows[0].count === 2) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Both amenity claims did not wait for the budget row lock");
}

test("concurrent claims, exhausted budget and failed provider response persist only one charge per venue", async () => {
  // Only connect to this throwaway cluster. No Places client or HTTP request is used.
  const directory = await mkdtemp(path.join(tmpdir(), "amenity-reservation-pg-"));
  const data = path.join(directory, "data");
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
  };
  let started = false;
  let pool;
  let lock;
  try {
    const port = await freePort();
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "amenity_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${port}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;
    delete process.env.NEON_DATABASE_URL;
    process.env.DATABASE_URL = `postgres://amenity_test@127.0.0.1:${port}/postgres`;

    const { pool: appPool } = await import("@workspace/db");
    pool = appPool;
    const { reserveAmenityDetails, failAmenityDetails } = await import("./placeAmenityReservations.ts");
    await pool.query(`
      CREATE TABLE crawler_progress (id integer PRIMARY KEY, monthly_budget_cents integer NOT NULL);
      INSERT INTO crawler_progress VALUES (1, 160);
      CREATE TABLE restaurants (
        place_id text PRIMARY KEY, amenities text[], source_name text NOT NULL,
        claim_status text, claimed_at timestamptz
      );
      CREATE TABLE restaurant_import_runs (
        id serial PRIMARY KEY, cities text[] NOT NULL, requested integer NOT NULL,
        imported integer NOT NULL, skipped_duplicates integer NOT NULL,
        api_calls integer NOT NULL, estimated_cost_cents integer NOT NULL,
        monthly_budget_cents integer NOT NULL, stopped_because text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO restaurants (place_id, source_name) VALUES
        ('race-place', 'google'), ('second-place', 'google'), ('over-budget', 'google');
    `);
    // Use the real attempt schema and refresh extension, not a mock of their constraints.
    await pool.query(await readFile(path.join(migrations, "0034_place_amenity_checks.sql"), "utf8"));
    await pool.query(await readFile(path.join(migrations, "0047_place_amenity_refresh.sql"), "utf8"));

    lock = await pool.connect();
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM crawler_progress WHERE id = 1 FOR UPDATE");
    const first = reserveAmenityDetails("race-place", options);
    const second = reserveAmenityDetails("race-place", options);
    await waitForBlockedClaims(pool);
    await lock.query("COMMIT");
    lock.release();
    lock = undefined;
    assert.deepEqual((await Promise.all([first, second])).sort(), ["duplicate", "reserved"]);

    const attempts = await pool.query(`
      SELECT c.place_id, c.status, c.reservation_id, r.api_calls, r.estimated_cost_cents
      FROM place_amenity_checks c JOIN restaurant_import_runs r ON r.id = c.reservation_id
      ORDER BY c.place_id
    `);
    assert.deepEqual(attempts.rows, [{
      place_id: "race-place", status: "pending", reservation_id: attempts.rows[0].reservation_id,
      api_calls: 1, estimated_cost_cents: 80,
    }]);
    assert.equal((await pool.query("SELECT count(*)::integer AS count FROM restaurant_import_runs")).rows[0].count, 1);

    // Simulate a provider rejection after the committed reservation. There is no network call.
    const provider = async () => { throw new Error("simulated provider failure"); };
    await assert.rejects(async () => {
      try { await provider(); }
      catch (error) { await failAmenityDetails("race-place"); throw error; }
    }, /simulated provider failure/);
    assert.equal(await reserveAmenityDetails("race-place", options), "duplicate");
    assert.deepEqual((await pool.query(
      "SELECT status, completed_at IS NOT NULL AS finished FROM place_amenity_checks WHERE place_id = 'race-place'",
    )).rows, [{ status: "failed", finished: true }]);

    // With only one charge left, distinct venues also contend for the same budget.
    lock = await pool.connect();
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM crawler_progress WHERE id = 1 FOR UPDATE");
    const secondPlace = reserveAmenityDetails("second-place", options);
    const overBudget = reserveAmenityDetails("over-budget", options);
    await waitForBlockedClaims(pool);
    await lock.query("COMMIT");
    lock.release();
    lock = undefined;
    const budgetResults = await Promise.all([secondPlace, overBudget]);
    assert.deepEqual(budgetResults.slice().sort(), ["budget", "reserved"]);
    const chargedPlace = budgetResults[0] === "reserved" ? "second-place" : "over-budget";
    const rejectedPlace = chargedPlace === "second-place" ? "over-budget" : "second-place";
    assert.deepEqual((await pool.query(`
      SELECT c.place_id, c.status, r.api_calls, r.estimated_cost_cents
      FROM place_amenity_checks c JOIN restaurant_import_runs r ON r.id = c.reservation_id
      ORDER BY c.place_id
    `)).rows, [
      { place_id: "race-place", status: "failed", api_calls: 1, estimated_cost_cents: 80 },
      { place_id: chargedPlace, status: "pending", api_calls: 1, estimated_cost_cents: 80 },
    ].sort((a, b) => a.place_id.localeCompare(b.place_id)));
    assert.equal((await pool.query(
      "SELECT count(*)::integer AS count FROM place_amenity_checks WHERE place_id = $1",
      [rejectedPlace],
    )).rows[0].count, 0);
    assert.deepEqual((await pool.query(`
      SELECT count(*)::integer AS attempts, sum(api_calls)::integer AS calls,
        sum(estimated_cost_cents)::integer AS cents FROM restaurant_import_runs
    `)).rows, [{ attempts: 3, calls: 2, cents: 160 }]);
    const { getPlacesAllowanceUsage } = await import("./placesAllowanceUsage.ts");
    const allowance = await getPlacesAllowanceUsage();
    assert.equal(allowance.requests, 2);
    assert.equal(allowance.denied, 1);
    assert.equal(allowance.estimatedCents, 160);
    assert.deepEqual(allowance.labels, [
      { label: "Place Details amenities", requests: 2, denied: 1, estimatedCents: 160 },
    ]);
    assert.ok(!JSON.stringify(allowance).includes(rejectedPlace));
  } finally {
    if (lock) { await lock.query("ROLLBACK"); lock.release(); }
    if (pool) await pool.end();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(directory, { recursive: true, force: true });
  }
});