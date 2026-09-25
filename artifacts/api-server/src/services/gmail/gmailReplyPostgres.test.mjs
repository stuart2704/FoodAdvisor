import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// This suite runs only against a throwaway, local PostgreSQL cluster. Never use
// the application's configured database (including the inherited Neon secret).
const require = createRequire(new URL("../../../../../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("concurrent poll/push reservations apply one Gmail reply, and failures release the ID", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gmail-reply-pg-"));
  const data = path.join(directory, "data");
  const port = await freePort();
  let started = false;
  let pool;
  let servicePool;
  try {
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "gmail_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${port}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;

    process.env.DATABASE_URL = `postgres://gmail_test@127.0.0.1:${port}/postgres`;
    delete process.env.NEON_DATABASE_URL;
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // Only columns used by the real service are needed. The message ID and
    // ownership foreign keys use the same PostgreSQL constraints as production.
    await pool.query(`
      CREATE TABLE restaurants (
        place_id text PRIMARY KEY,
        outreach_status text NOT NULL DEFAULT 'sent',
        suppressed_at timestamptz,
        suppression_reason text,
        public_business_email text
      );
      CREATE TABLE gmail_outreach_threads (
        thread_id text PRIMARY KEY,
        sent_message_id text NOT NULL UNIQUE,
        place_id text NOT NULL REFERENCES restaurants(place_id),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE processed_gmail_messages (
        message_id text PRIMARY KEY,
        thread_id text NOT NULL REFERENCES gmail_outreach_threads(thread_id),
        place_id text NOT NULL REFERENCES restaurants(place_id),
        processed_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE outreach_audit (
        id serial PRIMARY KEY,
        place_id text NOT NULL,
        event text NOT NULL,
        recipient_domain text,
        detail text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE test_state_updates (place_id text NOT NULL);
      CREATE TABLE operational_log_events (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        type text NOT NULL,
        message text NOT NULL,
        category text,
        bookmarked boolean NOT NULL DEFAULT false,
        tags text[] NOT NULL DEFAULT ARRAY[]::text[]
      );
      CREATE FUNCTION record_state_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO test_state_updates(place_id) VALUES (NEW.place_id);
        -- Keep the winner's reservation uncommitted while the second delivery
        -- attempts the same unique message ID on another connection.
        PERFORM pg_sleep(0.2);
        RETURN NEW;
      END $$;
      CREATE TRIGGER count_state_updates AFTER UPDATE ON restaurants
        FOR EACH ROW EXECUTE FUNCTION record_state_update();
    `);

    // Import only after the local database URL is installed. This imports the
    // real Drizzle client, classifier and transaction code, not a database mock.
    const { processGmailIncomingReply } = await import("../replyClassifier/processIncomingReply.ts");
    const { pool: actualServicePool } = await import("@workspace/db");
    servicePool = actualServicePool;

    await pool.query(
      `INSERT INTO restaurants(place_id, public_business_email) VALUES ($1, $2)`,
      ["pg-race-place", "owner@example.test"],
    );
    await pool.query(
      `INSERT INTO gmail_outreach_threads(thread_id, sent_message_id, place_id) VALUES ($1, $2, $3)`,
      ["pg-race-thread", "pg-original", "pg-race-place"],
    );
    const reply = {
      gmailMessageId: "pg-race-reply",
      gmailThreadId: "pg-race-thread",
      placeId: "pg-race-place",
      from: "Owner <owner@example.test>",
      body: "Yes, I am interested. Please tell me more.",
    };
    // Poll and push reach the same processor independently with the same ID.
    const deliveries = await Promise.all([
      processGmailIncomingReply({ ...reply }),
      processGmailIncomingReply({ ...reply }),
    ]);
    assert.deepEqual(deliveries.map((result) => result.status).sort(), ["duplicate", "processed"]);
    assert.equal(deliveries.find((result) => result.status === "processed").classification.category, "interested");
    assert.equal((await pool.query(
      `SELECT * FROM processed_gmail_messages WHERE message_id = $1`, [reply.gmailMessageId],
    )).rowCount, 1);
    const audit = await pool.query(
      `SELECT event, recipient_domain, detail FROM outreach_audit WHERE place_id = $1`, [reply.placeId],
    );
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].event, "reply_classified");
    assert.equal(audit.rows[0].recipient_domain, "example.test");
    assert.equal(JSON.parse(audit.rows[0].detail).category, "interested");
    assert.equal((await pool.query(
      `SELECT * FROM test_state_updates WHERE place_id = $1`, [reply.placeId],
    )).rowCount, 1);
    assert.equal((await pool.query(
      `SELECT outreach_status FROM restaurants WHERE place_id = $1`, [reply.placeId],
    )).rows[0].outreach_status, "interested");
    // Operational logging is intentionally asynchronous, outside the reply
    // transaction; wait for it rather than racing the background insert.
    let logged = 0;
    for (let i = 0; i < 30; i += 1) {
      logged = (await pool.query(
        `SELECT * FROM operational_log_events WHERE message = $1`, ["Reply processed"],
      )).rowCount;
      if (logged) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(logged, 1);

    // An orphan mapping cannot normally exist with the production foreign
    // keys. Relax just these constraints in the throwaway fixture to exercise
    // the defensive rollback path for damaged referential integrity.
    await pool.query(`
      ALTER TABLE gmail_outreach_threads DROP CONSTRAINT gmail_outreach_threads_place_id_fkey;
      ALTER TABLE processed_gmail_messages DROP CONSTRAINT processed_gmail_messages_place_id_fkey;
    `);
    const missing = {
      ...reply,
      placeId: "pg-missing-place",
      gmailThreadId: "pg-missing-thread",
      gmailMessageId: "pg-missing-reply",
    };
    await pool.query(
      `INSERT INTO gmail_outreach_threads(thread_id, sent_message_id, place_id) VALUES ($1, $2, $3)`,
      [missing.gmailThreadId, "pg-missing-original", missing.placeId],
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(processGmailIncomingReply(missing), /Mapped restaurant was not found/);
      assert.equal((await pool.query(
        `SELECT * FROM processed_gmail_messages WHERE message_id = $1`, [missing.gmailMessageId],
      )).rowCount, 0);
    }
    assert.equal((await pool.query(
      `SELECT * FROM outreach_audit WHERE place_id = $1`, [missing.placeId],
    )).rowCount, 0);
    assert.equal((await pool.query(
      `SELECT * FROM test_state_updates WHERE place_id = $1`, [missing.placeId],
    )).rowCount, 0);
    assert.equal((await pool.query(
      `SELECT * FROM operational_log_events WHERE message = $1`, ["Reply processed"],
    )).rowCount, 1);
  } finally {
    await servicePool?.end();
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(directory, { recursive: true, force: true });
  }
});