import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(new URL("../../../../../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const SETTINGS_ID = "00000000-0000-0000-0000-000000000000";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForLock(pool) {
  for (let i = 0; i < 150; i++) {
    const { rows } = await pool.query(`
      SELECT 1 FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
        AND query ILIKE '%social_settings%' LIMIT 1
    `);
    if (rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Scheduled claim did not reach the settings lock");
}

test("master OFF serializes scheduling and final claim; server OFF still permits Publish Now", async () => {
  // Never connect to inherited application credentials or a live provider.
  const directory = await mkdtemp(path.join(tmpdir(), "social-off-pg-"));
  const data = path.join(directory, "data");
  const pgPort = await freePort();
  let started = false;
  let pool, servicePool, server, lock;
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
    SOCIAL_TOKEN_ENCRYPTION_KEY: process.env.SOCIAL_TOKEN_ENCRYPTION_KEY,
    SOCIAL_AUTOMATION_ENABLED: process.env.SOCIAL_AUTOMATION_ENABLED,
    SOCIAL_EXTERNAL_SCHEDULER_VERIFIED: process.env.SOCIAL_EXTERNAL_SCHEDULER_VERIFIED,
  };
  let adapter, originalPublish;
  const originalFetch = globalThis.fetch;
  try {
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "social_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", ["-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${pgPort}`, "-w", "start"], { stdio: "pipe" });
    started = true;
    delete process.env.NEON_DATABASE_URL;
    process.env.DATABASE_URL = `postgres://social_test@127.0.0.1:${pgPort}/postgres`;
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = "local-test-only-key";
    process.env.SOCIAL_AUTOMATION_ENABLED = "true";
    process.env.SOCIAL_EXTERNAL_SCHEDULER_VERIFIED = "true";
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`
      CREATE TABLE social_settings (id uuid PRIMARY KEY, automation boolean NOT NULL DEFAULT false,
        worker_heartbeat_at timestamptz, worker_success_at timestamptz, worker_failure_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE social_posts (
        id uuid PRIMARY KEY, restaurant_id text, platform text NOT NULL, account_id uuid,
        content text NOT NULL, media_url text, media_object_path text, media_approved_at timestamptz,
        privacy_level text, status text NOT NULL, scheduled_for timestamp, published_at timestamp,
        error_message text, attempt_count integer NOT NULL DEFAULT 0, provider_post_id text,
        idempotency_key text NOT NULL UNIQUE, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
      );
      CREATE TABLE social_accounts (
        id uuid PRIMARY KEY, platform text NOT NULL, page_id text, display_name text,
        access_token text NOT NULL, access_token_iv text NOT NULL, access_token_tag text NOT NULL,
        refresh_token text, token_expires_at timestamptz, restaurant_id text,
        status text NOT NULL DEFAULT 'connected', created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
      );
      CREATE TABLE social_schedules (
        id uuid PRIMARY KEY, restaurant_id text, platform text NOT NULL, frequency text NOT NULL,
        time_of_day text NOT NULL, enabled boolean DEFAULT true, last_assigned_at timestamp,
        created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
      );
      CREATE TABLE social_logs (
        id uuid PRIMARY KEY, post_id uuid, account_id uuid, restaurant_id text,
        platform text NOT NULL, event text NOT NULL, status text NOT NULL, message text,
        attempt_count integer NOT NULL DEFAULT 0, duration_ms integer, created_at timestamp DEFAULT now()
      );
      INSERT INTO social_settings(id, automation) VALUES ('${SETTINGS_ID}', true);
    `);
    const { pool: actualPool } = await import("@workspace/db");
    servicePool = actualPool;
    const { encryptToken } = await import("./crypto.ts");
    const { facebookAdapter } = await import("./adapters/facebook.adapter.ts");
    adapter = facebookAdapter;
    originalPublish = adapter.publishPhoto;
    const submissions = [];
    adapter.publishPhoto = async (input) => {
      submissions.push(input.content);
      return { providerPostId: `fake-${submissions.length}` };
    };
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith("http://127.0.0.1:")) throw new Error("External network access is forbidden in the social OFF test");
      return originalFetch(url, init);
    };
    const { publishPostsJob } = await import("./workers/publishPosts.job.ts");
    const { schedulePostsJob } = await import("./workers/schedulePosts.job.ts");
    const { publishPost } = await import("./services/publishing.service.ts");
    const { default: router } = await import("./index.ts");
    const { default: express } = await import("express");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.session = { admin: true }; next(); });
    app.use(router);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function post(endpoint, body) {
      const response = await originalFetch(`${base}${endpoint}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    function insertPost(status, scheduledFor = null) {
      const id = randomUUID();
      return pool.query(
        "INSERT INTO social_posts(id, platform, content, status, scheduled_for, idempotency_key) VALUES ($1,'facebook',$2,$3,$4,$5)",
        [id, id, status, scheduledFor, id],
      ).then(() => id);
    }
    async function status(id) {
      return (await pool.query("SELECT status, scheduled_for, attempt_count FROM social_posts WHERE id = $1", [id])).rows[0];
    }
    const encrypted = encryptToken("fake-token");
    await pool.query(`INSERT INTO social_accounts(id, platform, page_id, access_token, access_token_iv, access_token_tag)
      VALUES ($1,'facebook','fake-page',$2,$3,$4)`,
    [randomUUID(), encrypted.encrypted, encrypted.iv, encrypted.tag]);
    const now = new Date("2026-09-28T12:00:00Z");
    await pool.query("INSERT INTO social_schedules(id, platform, frequency, time_of_day) VALUES ($1,'facebook','daily','11:59')", [randomUUID()]);

    // Hold the settings lock until a worker has selected the due post and is
    // waiting at its FINAL claim. OFF commits first; it cannot submit afterward.
    const due = await insertPost("scheduled", new Date(now.getTime() - 60_000));
    lock = await pool.connect();
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM social_settings WHERE id = $1 FOR UPDATE", [SETTINGS_ID]);
    const running = publishPostsJob(now);
    await waitForLock(pool);
    await lock.query("UPDATE social_settings SET automation = false WHERE id = $1", [SETTINGS_ID]);
    await lock.query("UPDATE social_posts SET status = 'draft', scheduled_for = NULL WHERE status = 'scheduled'");
    await lock.query("COMMIT");
    lock.release(); lock = null;
    await running;
    assert.equal((await status(due)).status, "draft");
    assert.equal((await status(due)).attempt_count, 0);
    assert.deepEqual(submissions, []);

    // The scheduling worker also selected its schedule before OFF, but may
    // assign a draft only after obtaining the same master row lock.
    await pool.query("UPDATE social_settings SET automation = true WHERE id = $1", [SETTINGS_ID]);
    const scheduleTime = new Date();
    scheduleTime.setSeconds(0, 0);
    await pool.query("UPDATE social_schedules SET time_of_day = $1, last_assigned_at = NULL",
      [`${String(scheduleTime.getUTCHours()).padStart(2, "0")}:${String(scheduleTime.getUTCMinutes()).padStart(2, "0")}`]);
    const selectedDraft = await insertPost("draft");
    lock = await pool.connect();
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM social_settings WHERE id = $1 FOR UPDATE", [SETTINGS_ID]);
    const scheduling = schedulePostsJob(new Date(scheduleTime.getTime() + 1000));
    await waitForLock(pool);
    await lock.query("UPDATE social_settings SET automation = false WHERE id = $1", [SETTINGS_ID]);
    await lock.query("COMMIT");
    lock.release(); lock = null;
    await scheduling;
    assert.equal((await status(selectedDraft)).status, "draft");

    // Reactivating via the real admin route clears overdue slots, but retains
    // future slots. A worker cannot send the former on its next pass.
    const overdue = await insertPost("scheduled", new Date(Date.now() - 60_000));
    const future = await insertPost("scheduled", new Date(Date.now() + 3_600_000));
    assert.equal((await post("/social/settings", { automation: true })).status, 200);
    assert.equal((await status(overdue)).status, "draft");
    assert.equal((await status(overdue)).scheduled_for, null);
    assert.equal((await status(future)).status, "scheduled");

    // The actual OFF endpoint persists OFF and unschedules the remaining post.
    assert.equal((await post("/social/settings", { automation: false })).status, 200);
    assert.equal((await pool.query("SELECT automation FROM social_settings WHERE id = $1", [SETTINGS_ID])).rows[0].automation, false);
    assert.equal((await status(future)).status, "draft");
    assert.equal((await status(future)).scheduled_for, null);
    assert.equal((await post("/social/settings", { automation: true })).status, 200);
    const pending = await insertPost("scheduled", new Date(Date.now() + 3_600_000));

    // Even when master stays ON, disabling the server while a claim is
    // waiting on the settings lock must suppress the final submission.
    lock = await pool.connect();
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM social_settings WHERE id = $1 FOR UPDATE", [SETTINGS_ID]);
    const claiming = publishPost(pending, { scheduledOnly: true });
    await waitForLock(pool);
    process.env.SOCIAL_AUTOMATION_ENABLED = "false";
    await lock.query("COMMIT");
    lock.release(); lock = null;
    assert.equal(await claiming, null);
    assert.equal((await status(pending)).attempt_count, 0);
    assert.deepEqual(submissions, []);
    process.env.SOCIAL_AUTOMATION_ENABLED = "true";

    // A stale scheduling selection and a stale claim both recheck the master
    // row, including when a server-only kill switch is flipped mid-run.
    const draft = await insertPost("draft");
    await pool.query("UPDATE social_settings SET automation = false WHERE id = $1", [SETTINGS_ID]);
    await schedulePostsJob(new Date());
    assert.equal((await status(draft)).status, "draft");
    assert.equal((await post("/social/posts/schedule", { postId: draft, time: new Date(Date.now() + 7200000).toISOString() })).status, 409);
    await pool.query("UPDATE social_settings SET automation = true WHERE id = $1", [SETTINGS_ID]);
    process.env.SOCIAL_AUTOMATION_ENABLED = "false";
    await schedulePostsJob(new Date(scheduleTime.getTime() + 1000));
    assert.equal((await status(selectedDraft)).status, "draft");
    assert.equal(await publishPost(pending, { scheduledOnly: true }), null);
    assert.equal((await status(pending)).attempt_count, 0);
    assert.equal((await post("/social/posts/schedule", { postId: draft, time: new Date(Date.now() + 7200000).toISOString() })).status, 409);
    await publishPostsJob(new Date(Date.now() + 7200000));
    assert.deepEqual(submissions, []);
    assert.equal((await post("/social/posts/publish", { postId: draft })).status, 200);
    assert.deepEqual(submissions, [draft]);
  } finally {
    if (lock) { await lock.query("ROLLBACK"); lock.release(); }
    if (adapter && originalPublish) adapter.publishPhoto = originalPublish;
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