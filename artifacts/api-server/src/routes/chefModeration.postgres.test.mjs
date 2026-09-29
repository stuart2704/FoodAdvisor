import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import express from "express";
import { getTableConfig } from "drizzle-orm/pg-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(new URL("../../../../lib/db/package.json", import.meta.url));
const { Pool } = require("pg");
const migrations = new URL("../../../../lib/db/migrations/", import.meta.url);
const placeId = "chef-moderation-test-place";
const token = "a".repeat(43);
const photoPath = "/objects/chef/00000000-0000-0000-0000-000000000135";
const photoUrl = "/storage/objects/chef/00000000-0000-0000-0000-000000000135";
const chefBody = {
  name: "Test Chef", bio: "A test biography", philosophy: "Seasonal food",
  awards: ["Award"], awardEvidenceUrls: ["https://example.test/award"],
  signatureDishes: ["Dish"], dishEvidenceUrls: ["https://example.test/dish"],
};

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// Bundle the actual routes and lifecycle queries. Only unrelated services and
// the object byte transport are replaced; all database calls use real Drizzle/PG.
async function bundleRoutes(outfile) {
  const stubs = new Map([
    ["portalTokenService", `export async function validateToken(value) {
      return value === "${token}" ? "${placeId}" : null;
    }`],
    ["chefObjectStorage", `export const CHEF_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
      export const CHEF_IMAGE_MAX_BYTES = 5242880;
      export async function streamChefObject(objectPath, res, cacheControl) {
        if (!objectPath.startsWith("/objects/chef/")) throw new Error("Unexpected photo path");
        globalThis.__chefPgStreams.push(objectPath);
        if (cacheControl) res.set("Cache-Control", cacheControl);
        res.type("image/png").send("test photo bytes");
      }
      export function createChefObjectPath() { throw new Error("Unexpected upload"); }
      export function createChefUploadUrl() { throw new Error("Unexpected upload"); }
      export function finalizeChefObject() { throw new Error("Unexpected upload"); }`],
    ["bookingLinkService", `export class BookingLinkError extends Error {}
      export function verifyBookingLink() { throw new Error("Unexpected booking check"); }`],
    ["analyticsEngine", `export async function logEvent() {}
      export async function getRestaurantAnalytics() { throw new Error("Unexpected analytics"); }`],
    ["ownerOfferMetrics", `export async function recordOwnerOfferOutcome() {}`],
    ["ownerAnalyticsInsight", `export async function generateOwnerAnalyticsInsight() {}`],
    ["personalisationEngine", `export async function recordOwnerLogin() {}`],
    ["ai", `export const seoLimiter = (_req, _res, next) => next();
      export const socialLimiter = seoLimiter;
      export async function generateSeoCopy() {}
      export async function generateSocialCopy() {}`],
  ]);
  await build({
    stdin: {
      contents: `export { default as admin } from "./adminChef.ts";
        export { default as owner } from "./portal.ts";
        export { default as photos } from "./chefStorage.ts";
        export { default as restaurant } from "./restaurant.ts";`,
      resolveDir: here, sourcefile: "chef-moderation-pg-entry.ts", loader: "ts",
    },
    outfile, bundle: true, packages: "external", platform: "node", format: "esm",
    plugins: [{
      name: "chef-test-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /(?:portalTokenService|chefObjectStorage|bookingLinkService|analyticsEngine|ownerOfferMetrics|ownerAnalyticsInsight|personalisationEngine|\/ai)$/ }, (args) => {
          const key = args.path.split("/").at(-1);
          return stubs.has(key) ? { path: key, namespace: "chef-test" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "chef-test" }, (args) =>
          ({ contents: stubs.get(args.path), loader: "js" }));
      },
    }],
  });
}

test("chef submission, review decisions and removals gate public profile and photos in PostgreSQL", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "chef-moderation-pg-"));
  const data = path.join(directory, "data");
  // External packages in an ESM bundle must resolve from the workspace, not /tmp.
  const bundle = path.join(here, "../../node_modules/.chef-moderation-pg-test.mjs");
  const previous = { DATABASE_URL: process.env.DATABASE_URL, NEON_DATABASE_URL: process.env.NEON_DATABASE_URL };
  let started = false;
  let pool, servicePool, server;
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
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { restaurantsTable, pool: actualPool } = await import("@workspace/db");
    servicePool = actualPool;
    const defaults = {
      source_name: "'google'", published: "true", currency: "'GBP'",
      types: "'{}'::text[]", cuisine_tags: "'{}'::text[]", dietary_tags: "'{}'::text[]",
      enrichment_status: "'pending'", imported_at: "now()", outreach_status: "'pending'",
      outreach_count: "0", opening_hours: "'{}'::text[]",
      delivery_platforms: "'{}'::text[]", social_links: "'{}'::jsonb",
      popularity: "0", ranking_score: "0", stripe_checkout_attempt: "0", premium: "false",
    };
    const restaurantColumns = getTableConfig(restaurantsTable).columns.map((column) =>
      `"${column.name}" ${column.getSQLType()}${column.name === "place_id" ? " PRIMARY KEY" : ""}` +
      (defaults[column.name] ? ` DEFAULT ${defaults[column.name]}` : ""));
    await pool.query(`CREATE TABLE restaurants (${restaurantColumns.join(", ")})`);
    await pool.query(`INSERT INTO restaurants (place_id, name, address, city, country, claimed_at, claim_status)
      VALUES ($1, 'Test Bistro', '1 Test Street', 'London', 'UK', now(), 'verified')`, [placeId]);
    for (const name of ["0011_restaurant_chef_profiles.sql", "0012_chef_photo_upload_intents.sql", "0032_chef_photo_deletion_queue.sql"]) {
      await pool.query(await readFile(new URL(name, migrations), "utf8"));
    }
    await pool.query(`CREATE TABLE restaurant_menu_items (
      id serial PRIMARY KEY, restaurant_id text, name text, price text, description text, category text
    ); CREATE TABLE restaurant_offers (
      id serial PRIMARY KEY, restaurant_id text, title text, description text, start_date date, end_date date
    ); CREATE TABLE restaurant_events (
      id serial PRIMARY KEY, restaurant_id text, title text, description text, event_date date, event_time text, price text
    ); CREATE TABLE restaurant_collections (
      id text PRIMARY KEY, title text, description text, city text
    ); CREATE TABLE restaurant_collection_members (
      id text PRIMARY KEY, collection_id text, restaurant_id text, position integer
    ); CREATE TABLE restaurant_profile_view_events (
      id serial PRIMARY KEY, place_id text, premium boolean, claimed boolean
    );`);
    await bundleRoutes(bundle);
    const { admin, owner, photos, restaurant } = await import(pathToFileURL(bundle).href);
    const app = express();
    const errors = [];
    globalThis.__chefPgStreams = [];
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { admin: req.get("x-test-admin") === "yes" };
      req.log = { warn() {}, error({ err }) { errors.push(err); } };
      next();
    });
    app.use("/api/admin", admin);
    app.use("/api", owner, photos, restaurant);
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function request(route, { method = "GET", body, adminAccess = false, revision } = {}) {
      const response = await fetch(base + route, {
        method, headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(adminAccess ? { "x-test-admin": "yes" } : {}),
          ...(revision ? { "x-chef-review-revision": revision } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return { status: response.status, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
    }
    const ownerRoute = `/portal/${token}/chef`;
    const adminRoute = `/admin/chef-profiles/${placeId}`;
    const profileRoute = `/restaurant/${placeId}`;
    async function visibility(expectedChef, expectedPhoto, label) {
      const profile = await request(profileRoute);
      assert.equal(profile.status, 200, `${label}: public profile`);
      assert.equal(profile.body.data.chef.name, expectedChef ? chefBody.name : null, label);
      assert.equal(profile.body.data.chef.photo, expectedChef ? `/api${photoUrl}` : null, label);
      assert.equal((await request(photoUrl)).status, expectedPhoto ? 200 : 404, `${label}: public photo`);
      assert.equal(globalThis.__chefPgStreams.length, expectedPhoto ? 1 : 0, `${label}: storage calls`);
      globalThis.__chefPgStreams.length = 0;
    }
    const submit = async () => {
      const result = await request(ownerRoute, { method: "PUT", body: chefBody });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.chef.moderationStatus, "pending");
      return result;
    };
    const pendingRevision = async () => {
      const list = await request("/admin/chef-profiles/pending", { adminAccess: true });
      assert.equal(list.status, 200);
      assert.equal(list.body.profiles.length, 1);
      assert.equal(list.body.profiles[0].restaurantName, "Test Bistro");
      return list.body.profiles[0].updatedAt;
    };
    const assertQueue = async (expected) => {
      const rows = (await pool.query("SELECT object_path FROM chef_photo_deletion_queue ORDER BY object_path")).rows;
      assert.deepEqual(rows.map((row) => row.object_path), expected);
    };

    await visibility(false, false, "initial");
    await submit();
    // Assign a photo path without contacting a photo service; subsequent owner
    // edits retain it through the real save transaction.
    await pool.query(`UPDATE restaurant_chef_profiles SET photo_object_path = $1,
      photo_mime_type = 'image/png', photo_size_bytes = 16 WHERE restaurant_id = $2`, [photoPath, placeId]);
    await visibility(false, false, "pending");
    assert.equal((await request(`${adminRoute}/photo`, { adminAccess: true })).status, 200);
    assert.equal((await request(`${adminRoute}/photo`)).status, 401);
    globalThis.__chefPgStreams.length = 0;
    let revision = await pendingRevision();
    let decided = await request(`${adminRoute}/approve`, { method: "POST", adminAccess: true, revision });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.profile.moderationStatus, "approved");
    assert.ok(decided.body.profile.verifiedAt);
    await visibility(true, true, "approved");
    assert.equal((await request(`${adminRoute}/reject`, {
      method: "POST", adminAccess: true, revision, body: { reason: "Stale" },
    })).status, 409);

    await submit(); // Re-submission revokes a previously approved public profile.
    await visibility(false, false, "resubmitted");
    revision = await pendingRevision();
    decided = await request(`${adminRoute}/reject`, {
      method: "POST", adminAccess: true, revision, body: { reason: "Evidence incomplete" },
    });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.profile.moderationStatus, "rejected");
    assert.equal(decided.body.profile.verifiedAt, null);
    assert.deepEqual((await request("/admin/chef-profiles/pending", { adminAccess: true })).body.profiles, []);
    await visibility(false, false, "rejected");

    assert.equal((await request(ownerRoute, { method: "DELETE" })).status, 200);
    await visibility(false, false, "owner deleted");
    assert.equal((await request(`${adminRoute}/photo`, { adminAccess: true })).status, 404);
    await assertQueue([photoPath]);
    await pool.query("DELETE FROM chef_photo_deletion_queue");

    await submit();
    // Supply a new path so the moderation deletion checks the same transaction
    // and queue behavior independently of the owner's deletion.
    const secondPhoto = "/objects/chef/00000000-0000-0000-0000-000000000136";
    const secondPhotoUrl = "/storage/objects/chef/00000000-0000-0000-0000-000000000136";
    await pool.query("UPDATE restaurant_chef_profiles SET photo_object_path = $1 WHERE restaurant_id = $2", [secondPhoto, placeId]);
    assert.equal((await request(secondPhotoUrl)).status, 404, "second pending photo is private");
    revision = await pendingRevision();
    decided = await request(adminRoute, { method: "DELETE", adminAccess: true, revision });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    await visibility(false, false, "admin removed");
    assert.equal((await request(secondPhotoUrl)).status, 404, "admin-removed photo is private");
    assert.equal((await request(`${adminRoute}/photo`, { adminAccess: true })).status, 404);
    await assertQueue([secondPhoto]);
    assert.equal((await request(adminRoute, { method: "DELETE", adminAccess: true, revision })).status, 409);
    assert.deepEqual(errors, []);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await servicePool?.end();
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(directory, { recursive: true, force: true });
    await rm(bundle, { force: true });
    delete globalThis.__chefPgStreams;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});