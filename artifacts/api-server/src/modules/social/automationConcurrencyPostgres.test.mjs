import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(new URL("../../../../../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const SETTINGS_ID = "00000000-0000-0000-0000-000000000000";
const now = new Date("2026-09-28T12:00:00Z");
const slot = new Date("2026-09-28T11:59:00Z");

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("overlapping cycles and restart boundaries never duplicate a Facebook submission", async () => {
  // This cluster is test-owned: neither inherited DB credentials nor a live Meta endpoint is used.
  const directory = await mkdtemp(path.join(tmpdir(), "social-concurrency-pg-"));
  const data = path.join(directory, "data");
  const pgPort = await freePort();
  let started = false;
  let pool, servicePool, adapter, originalPublish;
  const originalFetch = globalThis.fetch;
  const previous = Object.fromEntries(["DATABASE_URL", "NEON_DATABASE_URL",
    "SOCIAL_TOKEN_ENCRYPTION_KEY", "SOCIAL_AUTOMATION_ENABLED",
    "SOCIAL_EXTERNAL_SCHEDULER_VERIFIED"].map((key) => [key, process.env[key]]));
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
        updated_at timestamptz DEFAULT now());
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
    globalThis.fetch = async () => { throw new Error("External network access is forbidden in this test"); };
    const { runSocialAutomationCycle } = await import("../../cron/socialAutomation.ts");
    const { schedulePostsJob } = await import("./workers/schedulePosts.job.ts");
    const { publishPostsJob } = await import("./workers/publishPosts.job.ts");
    const { publishPost } = await import("./services/publishing.service.ts");

    const encrypted = encryptToken("fake-token");
    await pool.query(`INSERT INTO social_accounts(id, platform, page_id, access_token, access_token_iv, access_token_tag)
      VALUES ($1,'facebook','fake-page',$2,$3,$4)`,
    [randomUUID(), encrypted.encrypted, encrypted.iv, encrypted.tag]);
    const scheduleId = randomUUID();
    await pool.query("INSERT INTO social_schedules(id, platform, frequency, time_of_day) VALUES ($1,'facebook','daily','11:59')", [scheduleId]);
    async function draft() {
      const id = randomUUID();
      await pool.query("INSERT INTO social_posts(id, platform, content, status, idempotency_key) VALUES ($1,'facebook','Approved copy','draft',$2)", [id, id]);
      return id;
    }
    async function post(id) {
      return (await pool.query("SELECT status, scheduled_for, attempt_count, provider_post_id, error_message FROM social_posts WHERE id = $1", [id])).rows[0];
    }
    async function logs(id) {
      return (await pool.query("SELECT event, status, attempt_count, message FROM social_logs WHERE post_id = $1 ORDER BY created_at, event", [id])).rows;
    }
    async function reset() {
      await pool.query("TRUNCATE social_posts, social_logs");
      await pool.query("UPDATE social_schedules SET last_assigned_at = NULL WHERE id = $1", [scheduleId]);
    }

    // The second cycle arrives while the first is inside the provider call.
    // Its transaction-level lock must fail immediately, not issue another claim.
    const simultaneousId = await draft();
    const entered = deferred(), release = deferred();
    let submissions = 0;
    adapter.publishPhoto = async () => {
      submissions++;
      entered.resolve();
      await release.promise;
      return { providerPostId: "fake-first" };
    };
    const first = runSocialAutomationCycle(now);
    await entered.promise;
    assert.equal(await runSocialAutomationCycle(now), "busy");
    assert.equal((await post(simultaneousId)).status, "publishing");
    assert.equal((await post(simultaneousId)).attempt_count, 1);
    release.resolve();
    assert.equal(await first, "ran");
    assert.equal(submissions, 1);
    assert.equal((await post(simultaneousId)).status, "published");
    assert.equal((await post(simultaneousId)).provider_post_id, "fake-first");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM social_logs WHERE event = 'schedule' AND status = 'success'")).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM social_posts WHERE scheduled_for = $1", [slot])).rows[0].n, 1);
    assert.deepEqual((await logs(simultaneousId)).map(({ event, status }) => [event, status]),
      [["schedule", "success"], ["publish", "attempt"], ["publish", "success"]]);
    assert.equal((await pool.query("SELECT last_assigned_at FROM social_schedules WHERE id = $1", [scheduleId])).rows[0].last_assigned_at.toISOString(), slot.toISOString());
    assert.equal(await runSocialAutomationCycle(now), "ran");
    assert.equal(submissions, 1);

    // Crash before claim: assignment is committed, so the next worker pass resumes it.
    await reset();
    const assignedId = await draft();
    await schedulePostsJob(now);
    assert.equal((await post(assignedId)).status, "scheduled");
    assert.equal((await post(assignedId)).attempt_count, 0);
    adapter.publishPhoto = async () => { submissions++; return { providerPostId: "fake-resumed" }; };
    await runSocialAutomationCycle(now);
    assert.equal((await post(assignedId)).status, "published");
    assert.equal((await post(assignedId)).attempt_count, 1);
    assert.equal(submissions, 2);
    assert.equal((await logs(assignedId)).filter((log) => log.event === "publish" && log.status === "attempt").length, 1);

    // Crash after claim: a new worker must not retry a durable 'publishing' claim,
    // even when the old process has not returned from the provider.
    await reset();
    const claimedId = await draft();
    await schedulePostsJob(now);
    const claimedEntered = deferred(), claimedRelease = deferred();
    adapter.publishPhoto = async () => {
      submissions++;
      claimedEntered.resolve();
      await claimedRelease.promise;
      return { providerPostId: "fake-after-claim" };
    };
    const interrupted = publishPost(claimedId, { scheduledOnly: true });
    await claimedEntered.promise;
    assert.equal((await post(claimedId)).status, "publishing");
    await publishPostsJob(now); // fresh worker against persisted state
    assert.equal(submissions, 3);
    assert.equal((await post(claimedId)).attempt_count, 1);
    assert.deepEqual((await logs(claimedId)).filter((log) => log.event === "publish").map((log) => log.status), ["attempt"]);
    claimedRelease.resolve();
    await interrupted;
    assert.equal((await post(claimedId)).status, "published");

    // A timeout after Facebook may have accepted the submission is for operator
    // reconciliation, not an automatic retry on the next cycle.
    await reset();
    const uncertainId = await draft();
    await schedulePostsJob(now);
    adapter.publishPhoto = async () => { submissions++; throw new Error("timeout after acceptance"); };
    await publishPostsJob(now);
    assert.equal((await post(uncertainId)).status, "failed");
    assert.equal((await post(uncertainId)).attempt_count, 1);
    assert.match((await post(uncertainId)).error_message, /outcome is uncertain.*Check the provider account/);
    assert.deepEqual((await logs(uncertainId)).filter((log) => log.event === "publish").map((log) => log.status), ["attempt", "uncertain"]);
    await publishPostsJob(now);
    assert.equal(submissions, 4);

    // Facebook accepted but the database confirmation failed: keep 'publishing'
    // with the attempt log for reconciliation, never claim it again.
    await reset();
    const acceptedId = await draft();
    await schedulePostsJob(now);
    await pool.query(`
      CREATE FUNCTION reject_publish_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'published' THEN RAISE EXCEPTION 'simulated confirmation failure'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_publish_confirmation BEFORE UPDATE ON social_posts
        FOR EACH ROW EXECUTE FUNCTION reject_publish_confirmation();
    `);
    adapter.publishPhoto = async () => { submissions++; return { providerPostId: "accepted-but-unsaved" }; };
    await publishPostsJob(now);
    assert.equal((await post(acceptedId)).status, "publishing");
    assert.equal((await post(acceptedId)).attempt_count, 1);
    assert.deepEqual((await logs(acceptedId)).filter((log) => log.event === "publish").map((log) => log.status), ["attempt"]);
    await pool.query("DROP TRIGGER reject_publish_confirmation ON social_posts; DROP FUNCTION reject_publish_confirmation()");
    await publishPostsJob(now);
    assert.equal(submissions, 5);
    assert.equal((await post(acceptedId)).status, "publishing");
  } finally {
    if (adapter && originalPublish) adapter.publishPhoto = originalPublish;
    globalThis.fetch = originalFetch;
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