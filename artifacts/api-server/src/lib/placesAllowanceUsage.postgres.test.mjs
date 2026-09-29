import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("monthly categories include completed Search Text reservations and exclude old rows", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "places-allowance-pg-"));
  const data = path.join(directory, "data");
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
  };
  let started = false;
  let pool;
  try {
    const port = await freePort();
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "allowance_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${port}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;
    delete process.env.NEON_DATABASE_URL;
    process.env.DATABASE_URL = `postgres://allowance_test@127.0.0.1:${port}/postgres`;
    ({ pool } = await import("@workspace/db"));
    const { getPlacesAllowanceUsage } = await import("./placesAllowanceUsage.ts");
    await pool.query(`
      CREATE TABLE crawler_progress (id integer PRIMARY KEY, monthly_budget_cents integer NOT NULL);
      INSERT INTO crawler_progress VALUES (1, 3000);
      CREATE TABLE restaurant_import_runs (
        cities text[] NOT NULL, api_calls integer NOT NULL, estimated_cost_cents integer NOT NULL,
        stopped_because text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO restaurant_import_runs (cities, api_calls, estimated_cost_cents, stopped_because) VALUES
        (ARRAY['Search Text for London'], 1, 50, 'Completed within the monthly budget safety cap.'),
        (ARRAY['Search Text for Paris'], 1, 50, 'Places request reserved: Search Text for Paris'),
        (ARRAY['Search Text'], 0, 0, 'Places request denied: Search Text'),
        (ARRAY['Place photo details'], 1, 50, 'Places request reserved: Place photo details'),
        (ARRAY['Place photo media'], 0, 0, 'Places request denied: Place photo media'),
        (ARRAY['London'], 1, 50, 'Grid request reserved at point 4'),
        (ARRAY['London'], 0, 0, 'Grid request denied: monthly budget');
      INSERT INTO restaurant_import_runs (cities, api_calls, estimated_cost_cents, stopped_because, created_at)
      VALUES (ARRAY['Place photo media'], 1, 50, 'Places request reserved: Place photo media',
        date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '1 second');
    `);
    const usage = await getPlacesAllowanceUsage();
    assert.equal(usage.budgetCents, 3000);
    assert.deepEqual([usage.requests, usage.denied, usage.estimatedCents], [4, 3, 200]);
    assert.deepEqual(usage.labels, [
      { label: "Grid crawl", requests: 1, denied: 1, estimatedCents: 50 },
      { label: "Place photo details", requests: 1, denied: 0, estimatedCents: 50 },
      { label: "Place photo media", requests: 0, denied: 1, estimatedCents: 0 },
      { label: "Search Text", requests: 2, denied: 1, estimatedCents: 100 },
    ]);
    assert.ok(!JSON.stringify(usage).includes("London"));
    assert.ok(!JSON.stringify(usage).includes("Paris"));
  } finally {
    if (pool) await pool.end();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(directory, { recursive: true, force: true });
  }
});