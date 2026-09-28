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

test("public profile selects eligible offers and events against isolated PostgreSQL", async () => {
  // Import the real service only after replacing inherited application DB URLs.
  // Each test file has its own Node process, so the DB module cannot be cached
  // from another suite's connection.
  const directory = await mkdtemp(path.join(tmpdir(), "profile-content-pg-"));
  const data = path.join(directory, "data");
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
  };
  let started = false;
  let pool;
  let servicePool;
  try {
    const port = await freePort();
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "profile_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${port}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;
    delete process.env.NEON_DATABASE_URL;
    process.env.DATABASE_URL = `postgres://profile_test@127.0.0.1:${port}/postgres`;
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const { getTableConfig } = await import("drizzle-orm/pg-core");
    const { restaurantsTable, pool: actualServicePool } = await import("@workspace/db");
    servicePool = actualServicePool;
    // The profile selects every restaurant column. Generate just that wide
     // table from its mapping; keep the offer and event schemas independent
     // and literal so a wrong table/column/type in a query fails against PostgreSQL.
    const restaurantColumns = getTableConfig(restaurantsTable).columns.map((column) =>
      `"${column.name}" ${column.getSQLType()}${column.name === "place_id" ? " PRIMARY KEY" : ""}`,
    );
    await pool.query(`CREATE TABLE restaurants (${restaurantColumns.join(", ")})`);
    await pool.query(`
      CREATE TABLE restaurant_offers (
        id serial PRIMARY KEY,
        restaurant_id text NOT NULL REFERENCES restaurants(place_id),
        title text NOT NULL,
        description text NOT NULL,
        start_date date NOT NULL,
        end_date date NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE restaurant_menu_items (
        id serial PRIMARY KEY, restaurant_id text NOT NULL,
        name text NOT NULL, price text, description text, category text NOT NULL
      );
      CREATE TABLE restaurant_chef_profiles (
        restaurant_id text PRIMARY KEY, name text, bio text, philosophy text,
        awards text[], award_evidence_urls text[], signature_dishes text[],
        dish_evidence_urls text[], photo_object_path text, photo_mime_type text,
        photo_size_bytes integer, moderation_status text, verified_at timestamptz,
        reviewed_by text, rejection_reason text, updated_at timestamptz, created_at timestamptz
      );
      CREATE TABLE restaurant_events (
        id serial PRIMARY KEY, restaurant_id text NOT NULL, title text NOT NULL,
        description text NOT NULL, event_date date NOT NULL, event_time text NOT NULL,
        price text NOT NULL
      );
      CREATE TABLE restaurant_collections (
        id text PRIMARY KEY, title text NOT NULL, description text NOT NULL, city text NOT NULL
      );
      CREATE TABLE restaurant_collection_members (
        id text PRIMARY KEY, collection_id text NOT NULL, restaurant_id text NOT NULL,
        position integer NOT NULL
      );
    `);
    await pool.query(`
      INSERT INTO restaurants (
        place_id, name, address, city, country, source_name, published,
        claimed_at, claim_status, cuisine_tags, types, opening_hours,
        currency, popularity, premium
      ) VALUES
        ('verified-place', 'Test bistro', '1 Test Street', 'London', 'UK',
         'google', true, '2026-01-01T12:00:00Z', 'verified',
         '{}', '{}', '{}', 'GBP', 0, false),
        ('other-place', 'Other bistro', '2 Test Street', 'London', 'UK',
         'google', true, '2026-01-01T12:00:00Z', 'verified',
         '{}', '{}', '{}', 'GBP', 0, false),
        ('unverified-place', 'Unverified bistro', '3 Test Street', 'London', 'UK',
         'google', true, NULL, 'pending',
         '{}', '{}', '{}', 'GBP', 0, false),
        ('unpublished-place', 'Hidden bistro', '4 Test Street', 'London', 'UK',
         'google', false, '2026-01-01T12:00:00Z', 'verified',
         '{}', '{}', '{}', 'GBP', 0, false)
    `);
    const offers = [
      [40, "Sooner expiry", "2026-09-24", "2026-09-26", "verified-place"],
      [30, "Later start, high ID", "2026-09-24", "2026-09-30", "verified-place"],
      [22, "Earlier start", "2026-09-23", "2026-09-30", "verified-place"],
      [10, "Later start, low ID", "2026-09-24", "2026-09-30", "verified-place"],
      [50, "Ends today", "2026-09-20", "2026-09-25", "verified-place"],
      [51, "Today only", "2026-09-25", "2026-09-25", "verified-place"],
      [52, "Starts today", "2026-09-25", "2026-09-27", "verified-place"],
      [53, "Ended yesterday", "2026-09-20", "2026-09-24", "verified-place"],
      [54, "Starts tomorrow", "2026-09-26", "2026-09-30", "verified-place"],
      [55, "Other listing", "2026-09-25", "2026-09-25", "other-place"],
      [56, "Private", "2026-09-25", "2026-09-25", "unverified-place"],
      [57, "Unpublished", "2026-09-25", "2026-09-25", "unpublished-place"],
    ];
    for (const [id, title, startDate, endDate, restaurantId] of offers) {
      await pool.query(
        `INSERT INTO restaurant_offers (id, title, description, start_date, end_date, restaurant_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, title, `${title} description`, startDate, endDate, restaurantId],
      );
    }
    const events = [
      [30, "Tomorrow evening", "2026-09-26", "20:00", "verified-place"],
      [12, "Today evening", "2026-09-25", "20:00", "verified-place"],
      [13, "Yesterday", "2026-09-24", "23:59", "verified-place"],
      [11, "Today morning", "2026-09-25", "09:00", "verified-place"],
      [31, "Tomorrow morning", "2026-09-26", "09:00", "verified-place"],
      [10, "Today midnight", "2026-09-25", "00:00", "verified-place"],
      [14, "Today evening same time", "2026-09-25", "20:00", "verified-place"],
      [40, "Other listing", "2026-09-25", "08:00", "other-place"],
      [41, "Unverified listing", "2026-09-25", "08:00", "unverified-place"],
      [42, "Unpublished listing", "2026-09-25", "08:00", "unpublished-place"],
    ];
    for (const [id, title, date, time, restaurantId] of events) {
      await pool.query(
        `INSERT INTO restaurant_events (id, restaurant_id, title, description, event_date, event_time, price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, restaurantId, title, `${title} description`, date, time, "Free"],
      );
    }

    const { getRestaurantProfile } = await import("./restaurantProfileEngine.ts");
    const profile = await getRestaurantProfile("verified-place", new Date("2026-09-25T23:59:59Z"));
    assert.equal(profile.verified, true);
    assert.deepEqual(profile.events.map(({ title }) => title), [
      "Today midnight", "Today morning", "Today evening",
      "Today evening same time", "Tomorrow morning", "Tomorrow evening",
    ]);
    assert.deepEqual(profile.events[1], {
      id: 11, title: "Today morning", description: "Today morning description",
      date: "2026-09-25", time: "09:00", price: "Free",
    });
    assert.deepEqual(profile.offers.map(({ title }) => title), [
      "Ends today", "Today only", "Sooner expiry", "Starts today",
      "Earlier start", "Later start, low ID", "Later start, high ID",
    ]);
    assert.deepEqual(profile.offers[1], {
      title: "Today only", description: "Today only description",
      startDate: "2026-09-25", endDate: "2026-09-25",
    });
    const nextDay = await getRestaurantProfile("verified-place", new Date("2026-09-26T00:00:01Z"));
    assert.deepEqual(nextDay.offers.map(({ title }) => title), [
      "Sooner expiry", "Starts today", "Earlier start", "Later start, low ID",
      "Later start, high ID", "Starts tomorrow",
    ]);
    assert.deepEqual(nextDay.events.map(({ title }) => title), [
      "Tomorrow morning", "Tomorrow evening",
    ]);
    assert.deepEqual((await getRestaurantProfile("unverified-place", new Date("2026-09-25T12:00:00Z"))).offers, []);
    assert.deepEqual((await getRestaurantProfile("unverified-place", new Date("2026-09-25T12:00:00Z"))).events, []);
    assert.equal(await getRestaurantProfile("unpublished-place", new Date("2026-09-25T12:00:00Z")), null);
  } finally {
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