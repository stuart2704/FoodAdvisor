import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("cleanup skips a concurrent renewal, preserves fresh copy and active holds, and deletes only one batch", async () => {
  // Imports occur only after pointing the application pool at the isolated cluster.
  const directory = await mkdtemp(path.join(tmpdir(), "ai-cache-pg-"));
  const data = path.join(directory, "data");
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
  };
  let started = false;
  let pool;
  let renewalClient;
  let reservationClient;
  try {
    const port = await freePort();
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "ai_cache_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${port}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;
    delete process.env.NEON_DATABASE_URL;
    process.env.DATABASE_URL = `postgres://ai_cache_test@127.0.0.1:${port}/postgres`;

    const database = await import("@workspace/db");
    pool = database.pool;
    const { db, aiDescriptionCacheTable: cache } = database;
    const { cleanupExpiredAiDescriptions } = await import("./aiDescriptionCacheCleanup.ts");
    await pool.query(`
      CREATE TABLE ai_description_cache (
        cache_key text PRIMARY KEY,
        restaurant_id text NOT NULL,
        description text,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ai_description_cache_expires_at_idx ON ai_description_cache(expires_at);
    `);

    const now = new Date("2026-09-25T12:00:00Z");
    const expired = new Date(now.getTime() - 60_000);
    const fresh = new Date(now.getTime() + 60_000);
    const renewalAt = new Date(now.getTime() - 240_000);
    const staleReservation = new Date(now.getTime() - 180_000);
    await pool.query(`
      INSERT INTO ai_description_cache(cache_key, restaurant_id, description, expires_at, created_at)
      SELECT 'expired-' || lpad(n::text, 3, '0'), 'restaurant', 'old copy', $1, $2
      FROM generate_series(1, 201) AS n
    `, [expired, renewalAt]);
    await db.insert(cache).values([
      { cacheKey: "fresh-copy", restaurantId: "restaurant", description: "Keep this description", expiresAt: fresh },
      { cacheKey: "renewing", restaurantId: "restaurant", description: null, expiresAt: staleReservation, createdAt: renewalAt },
    ]);

    // A generator owns the old reservation and extends it while holding its row lock.
    // Cleanup must skip this locked row rather than remove a generation in progress.
    renewalClient = await pool.connect();
    await renewalClient.query("BEGIN");
    const renewed = await renewalClient.query(`
      UPDATE ai_description_cache SET expires_at = $1, updated_at = $2
      WHERE cache_key = 'renewing' AND created_at = $3 AND description IS NULL
      RETURNING cache_key
    `, [fresh, now, renewalAt]);
    assert.equal(renewed.rowCount, 1);

    // A second generator inserts an uncommitted reservation during cleanup.
    reservationClient = await pool.connect();
    await reservationClient.query("BEGIN");
    await drizzle(reservationClient).insert(cache).values({
      cacheKey: "active", restaurantId: "restaurant", description: null,
      createdAt: now, expiresAt: fresh,
    }).onConflictDoNothing({ target: cache.cacheKey });

    // A blocking cleanup must fail while the renewal transaction is still open.
    let timeout;
    try {
      assert.equal(await Promise.race([
        cleanupExpiredAiDescriptions(now),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("cleanup blocked on a generating row")), 3000);
        }),
      ]), 200);
    } finally {
      clearTimeout(timeout);
    }
    await reservationClient.query("COMMIT");
    reservationClient.release();
    reservationClient = undefined;
    await renewalClient.query("COMMIT");
    renewalClient.release();
    renewalClient = undefined;

    const { rows } = await pool.query(`
      SELECT cache_key, description, expires_at FROM ai_description_cache
      ORDER BY cache_key
    `);
    assert.equal(rows.filter((row) => row.cache_key.startsWith("expired-")).length, 1);
    assert.deepEqual(rows.filter((row) => !row.cache_key.startsWith("expired-"))
      .map((row) => [row.cache_key, row.description]),
    [["active", null], ["fresh-copy", "Keep this description"], ["renewing", null]]);
    assert.equal(rows.find((row) => row.cache_key === "renewing").expires_at.getTime(), fresh.getTime());

    // The same identity/expiry guard used by generation can still finalize both holds.
    for (const [key, createdAt] of [["active", now], ["renewing", renewalAt]]) {
      const [saved] = await db.update(cache)
        .set({ description: `${key} description`, expiresAt: fresh, updatedAt: now })
        .where(and(eq(cache.cacheKey, key), eq(cache.createdAt, createdAt),
          gt(cache.expiresAt, now)))
        .returning({ cacheKey: cache.cacheKey });
      assert.equal(saved?.cacheKey, key);
    }
    assert.equal(await cleanupExpiredAiDescriptions(now), 1);
    assert.equal(await cleanupExpiredAiDescriptions(now), 0);
    const remaining = await pool.query("SELECT cache_key, description FROM ai_description_cache ORDER BY cache_key");
    assert.deepEqual(remaining.rows, [
      { cache_key: "active", description: "active description" },
      { cache_key: "fresh-copy", description: "Keep this description" },
      { cache_key: "renewing", description: "renewing description" },
    ]);
  } finally {
    if (reservationClient) {
      await reservationClient.query("ROLLBACK");
      reservationClient.release();
    }
    if (renewalClient) {
      await renewalClient.query("ROLLBACK");
      renewalClient.release();
    }
    if (pool) await pool.end();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(directory, { recursive: true, force: true });
  }
});