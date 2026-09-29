import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function untilBlocked(pool, fragment) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE $1 LIMIT 1`,
      [`%${fragment}%`],
    );
    if (rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const { rows } = await pool.query(
    "SELECT wait_event_type, wait_event, query FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state = 'active'",
  );
  throw new Error(`Timed out waiting for PostgreSQL lock: ${fragment}; active: ${JSON.stringify(rows)}`);
}

test("chef photo cleanup coordinates with profile writes, SKIP LOCKED and retries", { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "chef-cleanup-pg-"));
  const data = path.join(directory, "data");
  // Keep the bundled module within the package so external workspace dependencies
  // resolve from the same node_modules as the real profile writer.
  const bundle = path.join(import.meta.dirname, "../../node_modules", `.chef-cleanup-${path.basename(directory)}.mjs`);
  const previous = { DATABASE_URL: process.env.DATABASE_URL, NEON_DATABASE_URL: process.env.NEON_DATABASE_URL };
  let started = false;
  let pool;
  let blocker;
  try {
    const port = await freePort();
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "chef_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${port}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;
    delete process.env.NEON_DATABASE_URL;
    process.env.DATABASE_URL = `postgres://chef_test@127.0.0.1:${port}/postgres`;

    const database = await import("@workspace/db");
    pool = database.pool;
    const { saveChefProfile, removeChefProfile } = await import("../services/chefPhotoLifecycle.ts");
    const deleted = [];
    const failures = new Set();
    let holdDelete;
    globalThis.__chefPhotoPgDelete = async (objectPath) => {
      if (failures.has(objectPath)) throw new Error("storage unavailable");
      if (objectPath === "slow-photo" && holdDelete) await holdDelete();
      deleted.push(objectPath);
    };
    await build({
      entryPoints: [path.join(import.meta.dirname, "chefPhotoCleanup.ts")],
      outfile: bundle, bundle: true, platform: "node", format: "esm",
      packages: "external",
      plugins: [{
        name: "mock-remote-delete",
        setup(plugin) {
          plugin.onResolve({ filter: /chefObjectStorage$/ }, () => ({ path: "storage", namespace: "fake" }));
          plugin.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
            contents: "export const deleteChefObject = (path) => globalThis.__chefPhotoPgDelete(path);",
            loader: "js",
          }));
        },
      }],
      logLevel: "silent",
    });
    const { cleanupChefPhotos } = await import(pathToFileURL(bundle).href);
    await pool.query(`
      CREATE TABLE restaurants (place_id text PRIMARY KEY);
      CREATE TABLE restaurant_chef_profiles (
        restaurant_id text PRIMARY KEY REFERENCES restaurants(place_id) ON DELETE CASCADE,
        name text, bio text, philosophy text, awards text[] NOT NULL DEFAULT '{}',
        award_evidence_urls text[] NOT NULL DEFAULT '{}', signature_dishes text[] NOT NULL DEFAULT '{}',
        dish_evidence_urls text[] NOT NULL DEFAULT '{}', photo_object_path text,
        photo_mime_type text, photo_size_bytes integer, moderation_status text NOT NULL DEFAULT 'pending',
        verified_at timestamptz, reviewed_by text, rejection_reason text,
        updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE chef_photo_deletion_queue (
        object_path text PRIMARY KEY, due_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE chef_photo_upload_intents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), object_path text NOT NULL UNIQUE,
        restaurant_id text NOT NULL REFERENCES restaurants(place_id),
        content_type text NOT NULL, size_bytes integer NOT NULL,
        expires_at timestamptz NOT NULL, consumed_at timestamptz,
        cleanup_after timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO restaurants(place_id) VALUES ('pending'), ('approved'), ('replacement'), ('removed');
    `);
    const now = new Date();
    const due = new Date(now.getTime() - 48 * 60 * 60_000);
    const queue = async (objectPath) => pool.query(
      "INSERT INTO chef_photo_deletion_queue(object_path, due_at) VALUES ($1, $2)", [objectPath, due],
    );

    // The writer holds the photo advisory lock while waiting to insert its pending
    // profile. Cleanup claims the stale queue row but must wait until the writer
    // commits before deciding whether the object is referenced.
    blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM restaurants WHERE place_id = 'pending' FOR UPDATE");
    const writing = saveChefProfile("pending", () => ({
      restaurantId: "pending", photoObjectPath: "racing-photo", moderationStatus: "pending",
    }));
    await untilBlocked(pool, "insert into \"restaurant_chef_profiles\"");
    await queue("racing-photo");
    const cleaning = cleanupChefPhotos(now);
    await untilBlocked(pool, "pg_advisory_xact_lock");
    await blocker.query("COMMIT");
    blocker.release();
    blocker = undefined;
    await Promise.all([writing, cleaning]);
    assert.deepEqual(deleted, []);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM chef_photo_deletion_queue")).rows[0].n, 0);
    assert.equal((await pool.query("SELECT photo_object_path FROM restaurant_chef_profiles WHERE restaurant_id = 'pending'")).rows[0].photo_object_path, "racing-photo");

    await saveChefProfile("approved", () => ({
      restaurantId: "approved", photoObjectPath: "approved-photo", moderationStatus: "approved",
    }));
    await queue("approved-photo");
    await pool.query(`
      INSERT INTO chef_photo_upload_intents(object_path, restaurant_id, content_type, size_bytes, expires_at, cleanup_after)
      VALUES ('racing-photo', 'pending', 'image/jpeg', 100, $1, $1),
             ('abandoned', 'removed', 'image/jpeg', 100, $1, $1)
    `, [due]);
    await cleanupChefPhotos(now);
    assert.deepEqual(deleted, ["abandoned"]);
    assert.deepEqual((await pool.query("SELECT object_path FROM chef_photo_upload_intents")).rows.map((r) => r.object_path), []);

    await pool.query(`
      INSERT INTO chef_photo_upload_intents(object_path, restaurant_id, content_type, size_bytes, expires_at, cleanup_after)
      VALUES ('failed-intent', 'removed', 'image/jpeg', 100, $1, $1)
    `, [due]);
    failures.add("failed-intent");
    await cleanupChefPhotos(now);
    assert.equal((await pool.query("SELECT cleanup_after FROM chef_photo_upload_intents WHERE object_path = 'failed-intent'")).rows[0].cleanup_after.getTime(), now.getTime() + 60 * 60_000);
    failures.clear();
    await cleanupChefPhotos(new Date(now.getTime() + 60 * 60_000));
    assert.deepEqual(deleted, ["abandoned", "failed-intent"]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM chef_photo_upload_intents")).rows[0].n, 0);

    await saveChefProfile("replacement", () => ({
      restaurantId: "replacement", photoObjectPath: "old-photo",
    }));
    await saveChefProfile("replacement", () => ({
      restaurantId: "replacement", photoObjectPath: "new-photo",
    }));
    await saveChefProfile("removed", () => ({
      restaurantId: "removed", photoObjectPath: "removed-photo",
    }));
    await queue("removed-photo");
    blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM restaurant_chef_profiles WHERE restaurant_id = 'removed' FOR UPDATE");
    const removing = removeChefProfile("removed");
    await untilBlocked(pool, 'delete from "restaurant_chef_profiles"');
    // Until the removal commits, cleanup still sees a live reference.
    await cleanupChefPhotos(now);
    assert.equal(deleted.includes("removed-photo"), false);
    await blocker.query("COMMIT");
    blocker.release();
    blocker = undefined;
    await removing;
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM chef_photo_deletion_queue WHERE object_path = 'removed-photo'")).rows[0].n, 1);
    // Advance the lifecycle's 20-minute grace period in the disposable database.
    await pool.query("UPDATE chef_photo_deletion_queue SET due_at = $1", [due]);

    // A second connection owns one due row; SKIP LOCKED should still allow the
    // worker to delete other due objects rather than hang on that row.
    blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT 1 FROM chef_photo_deletion_queue WHERE object_path = 'old-photo' FOR UPDATE");
    failures.add("removed-photo");
    await cleanupChefPhotos(now);
    assert.deepEqual(deleted, ["abandoned", "failed-intent"]);
    assert.equal((await pool.query("SELECT due_at FROM chef_photo_deletion_queue WHERE object_path = 'removed-photo'")).rows[0].due_at.getTime(), now.getTime() + 60 * 60_000);
    await blocker.query("COMMIT");
    blocker.release();
    blocker = undefined;
    await cleanupChefPhotos(now);
    assert.deepEqual(deleted, ["abandoned", "failed-intent", "old-photo"]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM chef_photo_deletion_queue WHERE object_path = 'old-photo'")).rows[0].n, 0);
    failures.clear();
    await cleanupChefPhotos(new Date(now.getTime() + 60 * 60_000));
    assert.deepEqual(deleted, ["abandoned", "failed-intent", "old-photo", "removed-photo"]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM chef_photo_deletion_queue")).rows[0].n, 0);
    assert.deepEqual((await pool.query("SELECT restaurant_id, photo_object_path FROM restaurant_chef_profiles ORDER BY restaurant_id")).rows, [
      { restaurant_id: "approved", photo_object_path: "approved-photo" },
      { restaurant_id: "pending", photo_object_path: "racing-photo" },
      { restaurant_id: "replacement", photo_object_path: "new-photo" },
    ]);

    // One worker owns the row lock throughout the remote call. A second worker
    // must skip it, not call storage a second time or wait for the first worker.
    await queue("slow-photo");
    let startedDelete;
    const deleting = new Promise((resolve) => { startedDelete = resolve; });
    let releaseDelete;
    const released = new Promise((resolve) => { releaseDelete = resolve; });
    holdDelete = async () => {
      startedDelete();
      await released;
    };
    const firstWorker = cleanupChefPhotos(now);
    try {
      await deleting;
      let timer;
      try {
        await Promise.race([
          cleanupChefPhotos(now),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("second worker waited for locked row")), 2000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      assert.equal(deleted.includes("slow-photo"), false);
    } finally {
      releaseDelete();
      await firstWorker;
    }
    assert.equal(deleted.filter((p) => p === "slow-photo").length, 1);
  } finally {
    if (blocker) {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    await pool?.end();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete globalThis.__chefPhotoPgDelete;
    await rm(bundle, { force: true });
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(directory, { recursive: true, force: true });
  }
});