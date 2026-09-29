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

async function waitForRows(pool, count) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query(
      "SELECT count(*)::int AS count FROM operational_log_events WHERE type = 'queue'",
    );
    if (result.rows[0].count === count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${count} persisted queue events`);
}

test("engine totals use persisted bounded durations and a rolling five-minute window", async () => {
  // Import the application pool only after isolating its connection from real data.
  const directory = await mkdtemp(path.join(tmpdir(), "engine-timing-pg-"));
  const data = path.join(directory, "data");
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
  };
  let started = false;
  let pool;
  try {
    const port = await freePort();
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "timing_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${port}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;
    delete process.env.NEON_DATABASE_URL;
    process.env.DATABASE_URL = `postgres://timing_test@127.0.0.1:${port}/postgres`;

    ({ pool } = await import("@workspace/db"));
    const { getEnginePerformanceMetrics } = await import("./operationalLog.ts");
    const { logEvent } = await import("../utils/eventLog.ts");
    await pool.query(`
      CREATE TABLE operational_log_events (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        type text NOT NULL,
        message text NOT NULL,
        category text,
        duration_ms integer,
        bookmarked boolean NOT NULL DEFAULT false,
        tags text[] NOT NULL DEFAULT ARRAY[]::text[]
      )
    `);

    // Deliberately uneven samples distinguish percentile_cont from max, median,
    // discrete percentiles and averages. Legacy rows count as events, not samples.
    await pool.query(`
      INSERT INTO operational_log_events (id, created_at, type, message, category, duration_ms)
      VALUES
        ('a', now(), 'api', 'first', 'info', 100),
        ('b', now(), 'api', 'second', 'error', 200),
        ('c', now(), 'api', 'third', 'success', 300),
        ('legacy', now(), 'api', 'legacy', 'error', NULL),
        ('old', now() - interval '6 minutes', 'api', 'expired', 'error', 9999),
        ('null-only', now(), 'database', 'legacy', 'info', NULL)
    `);

    logEvent("queue", "capped", "success", [], 700_000);
    logEvent("queue", "rounded", "success", [], 0.4);
    logEvent("queue", "negative", "success", [], -1);
    logEvent("queue", "infinite", "success", [], Infinity);
    logEvent("queue", "nan", "success", [], NaN);
    await waitForRows(pool, 5);
    const saved = await pool.query(
      "SELECT message, duration_ms FROM operational_log_events WHERE type = 'queue' ORDER BY message",
    );
    assert.deepEqual(saved.rows, [
      { message: "capped", duration_ms: 600_000 },
      { message: "infinite", duration_ms: null },
      { message: "nan", duration_ms: null },
      { message: "negative", duration_ms: null },
      { message: "rounded", duration_ms: 0 },
    ]);

    const metrics = await getEnginePerformanceMetrics();
    assert.deepEqual(metrics.api, {
      total: 4, errors: 2, successes: 2, error_rate: 0.5, success_rate: 0.5,
      latency_samples: 3, avg_latency_ms: 200, p95_latency_ms: 290,
    });
    assert.deepEqual(metrics.queue, {
      total: 5, errors: 0, successes: 5, error_rate: 0, success_rate: 1,
      latency_samples: 2, avg_latency_ms: 300_000, p95_latency_ms: 570_000,
    });
    assert.deepEqual(metrics.database, {
      total: 1, errors: 0, successes: 1, error_rate: 0, success_rate: 1,
      latency_samples: 0, avg_latency_ms: null, p95_latency_ms: null,
    });

    // Age the recent samples out, leaving the legacy null row in the window.
    await pool.query(`
      UPDATE operational_log_events SET created_at = now() - interval '6 minutes'
      WHERE type = 'queue' OR (type = 'api' AND duration_ms IS NOT NULL)
    `);
    const afterExpiry = await getEnginePerformanceMetrics();
    assert.equal(afterExpiry.queue, undefined);
    assert.deepEqual(afterExpiry.api, {
      total: 1, errors: 1, successes: 0, error_rate: 1, success_rate: 0,
      latency_samples: 0, avg_latency_ms: null, p95_latency_ms: null,
    });
    assert.deepEqual(afterExpiry.database, metrics.database);
  } finally {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});