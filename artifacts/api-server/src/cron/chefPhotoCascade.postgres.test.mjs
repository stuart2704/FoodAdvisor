import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(new URL("../../../../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const migration = new URL("../../../../lib/db/migrations/0045_chef_photo_cascade_cleanup.sql", import.meta.url);

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("restaurant cascades preserve chef profile and upload intent paths in the deletion queue", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "chef-cascade-pg-"));
  const data = path.join(directory, "data");
  let started = false;
  let pool;
  try {
    const port = await freePort();
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "chef_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${port}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;
    pool = new Pool({ connectionString: `postgres://chef_test@127.0.0.1:${port}/postgres` });
    await pool.query(`
      CREATE TABLE restaurants (place_id text PRIMARY KEY);
      CREATE TABLE restaurant_chef_profiles (
        restaurant_id text PRIMARY KEY REFERENCES restaurants(place_id) ON DELETE CASCADE,
        photo_object_path text
      );
      CREATE TABLE chef_photo_upload_intents (
        object_path text PRIMARY KEY,
        restaurant_id text NOT NULL REFERENCES restaurants(place_id) ON DELETE CASCADE
      );
      CREATE TABLE chef_photo_deletion_queue (
        object_path text PRIMARY KEY,
        due_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await pool.query(await readFile(migration, "utf8"));

    await pool.query("INSERT INTO restaurants VALUES ('deleted'), ('remaining'), ('rolled-back')");
    await pool.query("INSERT INTO restaurant_chef_profiles VALUES ('deleted', 'old-photo'), ('remaining', 'live-photo'), ('rolled-back', 'rolled-back-photo')");
    await pool.query("INSERT INTO chef_photo_upload_intents VALUES ('in-flight', 'deleted'), ('live-intent', 'remaining')");

    // Routine removals must not create unnecessary queue entries.
    await pool.query("DELETE FROM chef_photo_upload_intents WHERE object_path = 'live-intent'");
    await pool.query("DELETE FROM restaurant_chef_profiles WHERE restaurant_id = 'remaining'");
    assert.equal((await pool.query("SELECT count(*)::integer AS total FROM chef_photo_deletion_queue")).rows[0].total, 0);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM restaurants WHERE place_id = 'rolled-back'");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    assert.equal((await pool.query("SELECT count(*)::integer AS total FROM chef_photo_deletion_queue")).rows[0].total, 0);

    await pool.query("DELETE FROM restaurants WHERE place_id = 'deleted'");
    const queued = (await pool.query("SELECT object_path, due_at FROM chef_photo_deletion_queue ORDER BY object_path")).rows;
    assert.deepEqual(queued.map(({ object_path }) => object_path), ["in-flight", "old-photo"]);
    assert.ok(queued.every(({ due_at }) => due_at.getTime() > Date.now() + 15 * 60_000));
    assert.equal((await pool.query("SELECT count(*)::integer AS total FROM chef_photo_upload_intents WHERE restaurant_id = 'deleted'")).rows[0].total, 0);
    assert.equal((await pool.query("SELECT count(*)::integer AS total FROM restaurant_chef_profiles WHERE restaurant_id = 'deleted'")).rows[0].total, 0);

    // A queue row is not authority to delete a path: the cleanup worker must
    // recheck live profile references when the row becomes due.
    await pool.query("INSERT INTO restaurant_chef_profiles VALUES ('remaining', 'old-photo')");
    assert.equal((await pool.query("SELECT count(*)::integer AS total FROM restaurant_chef_profiles WHERE photo_object_path = 'old-photo'")).rows[0].total, 1);
  } finally {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(directory, { recursive: true, force: true });
  }
});