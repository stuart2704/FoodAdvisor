import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, rm, mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForOtherInstance(pool) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const result = await pool.query(`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
        AND query LIKE '%pg_advisory_xact_lock(hashtextextended%'
    `);
    if (result.rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Second instance did not wait on the shared lookup lock");
}

test("separate API instances share details and media without duplicate reservations", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "photo-cache-pg-"));
  const data = path.join(directory, "data");
  // Keep the bundle below node_modules so its external @workspace/db resolves from this project.
  const bundleDir = path.resolve(import.meta.dirname, "../../node_modules/.photo-cache-test");
  const saved = { DATABASE_URL: process.env.DATABASE_URL, NEON_DATABASE_URL: process.env.NEON_DATABASE_URL };
  let started = false;
  let pool;
  const originalFetch = globalThis.fetch;
  try {
    const port = await freePort();
    execFileSync("initdb", ["-D", data, "-A", "trust", "-U", "photo_test"], { stdio: "pipe" });
    execFileSync("pg_ctl", [
      "-D", data, "-l", path.join(directory, "postgres.log"),
      "-o", `-h 127.0.0.1 -k '${directory}' -p ${port}`, "-w", "start",
    ], { stdio: "pipe" });
    started = true;
    delete process.env.NEON_DATABASE_URL;
    process.env.DATABASE_URL = `postgres://photo_test@127.0.0.1:${port}/postgres`;
    ({ pool } = await import("@workspace/db"));
    await pool.query(await readFile(new URL("../../../../lib/db/migrations/0048_place_photo_lookup_cache.sql", import.meta.url), "utf8"));

    globalThis.photoCalls = [];
    globalThis.exhausted = false;
    let releaseFirst;
    globalThis.photoDelay = new Promise((resolve) => { releaseFirst = resolve; });
    globalThis.firstPhotoCall = new Promise((resolve) => { globalThis.signalFirstPhotoCall = resolve; });
    await mkdir(bundleDir, { recursive: true });
    const modules = [];
    for (const instance of ["a", "b"]) {
      const outfile = path.join(bundleDir, `${instance}.mjs`);
      await build({
        entryPoints: [path.resolve(import.meta.dirname, "placePhotoLookup.ts")],
        outfile, bundle: true, platform: "node", format: "esm",
        packages: "external",
        plugins: [{
          name: "mock-provider",
          setup(builder) {
            builder.onResolve({ filter: /budgetedPlacesFetch$/ }, () => ({ path: "budget", namespace: "fixture" }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              contents: `export class PlacesBudgetExceededError extends Error {
                constructor() { super("Budget exhausted"); this.name = "PlacesBudgetExceededError"; }
              }
              export async function budgetedPlacesFetch(url) {
                globalThis.photoCalls.push(url);
                if (globalThis.exhausted) throw new PlacesBudgetExceededError();
                if (globalThis.photoDelay) {
                  globalThis.signalFirstPhotoCall();
                  await globalThis.photoDelay;
                }
                return new Response(JSON.stringify(url.includes("/media?")
                  ? { photoUri: "https://images.example/photo" }
                  : { photos: [{ name: "places/shared/photos/first",
                      authorAttributions: [{ displayName: "Photographer", uri: "https://example.com/credit" }] }] }));
              }`,
              loader: "js",
            }));
          },
        }],
      });
      modules.push(await import(pathToFileURL(outfile).href));
    }
    const first = modules[0].getPlacePhotos("shared", "key", 1);
    await globalThis.firstPhotoCall;
    const second = modules[1].getPlacePhotos("shared", "key", 1);
    await waitForOtherInstance(pool);
    releaseFirst();
    globalThis.photoDelay = null;
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, b);
    assert.equal(a[0].attribution[0].displayName, "Photographer");
    assert.equal(globalThis.photoCalls.length, 2); // One details and one media request.
    await modules[1].getPlacePhotos("shared", "key", 1);
    assert.equal(globalThis.photoCalls.length, 2);
    const stored = await pool.query("SELECT kind, value FROM place_photo_lookup_cache ORDER BY kind");
    assert.deepEqual(stored.rows.map(row => row.kind), ["details", "media"]);
    assert.equal(stored.rows[0].value[0].authorAttributions[0].displayName, "Photographer");

    await pool.query("UPDATE place_photo_lookup_cache SET expires_at = now() - interval '1 minute'");
    await modules[1].getPlacePhotos("shared", "key", 1);
    assert.equal(globalThis.photoCalls.length, 4);

    globalThis.exhausted = true;
    await assert.rejects(modules[0].getPlacePhotos("blocked", "key", 1), { name: "PlacesBudgetExceededError" });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM place_photo_lookup_cache")).rows[0].n, 2);
    globalThis.exhausted = false;
    await modules[1].getPlacePhotos("blocked", "key", 1);
    assert.equal(globalThis.photoCalls.length, 6); // Media name is shared with the first place.

    await pool.query(`
      INSERT INTO place_photo_lookup_cache (cache_key, kind, value, expires_at)
      SELECT 'filler-' || n, 'media', '"https://images.example/filler"'::jsonb,
             now() + interval '30 minutes'
      FROM generate_series(1, 1001) AS n
    `);
    await pool.query(`
      INSERT INTO place_photo_lookup_cache (cache_key, kind, value, expires_at)
      VALUES ('expired-filler', 'details', '[]'::jsonb, now() - interval '1 minute')
    `);
    await modules[0].getPlacePhotos("prune", "key", 1);
    const bounded = await pool.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE cache_key = 'expired-filler')::int AS expired
      FROM place_photo_lookup_cache
    `);
    assert.equal(bounded.rows[0].total, 1000);
    assert.equal(bounded.rows[0].expired, 0);

    // Unlike the mocked concurrency test above, this runs budgetedPlacesFetch
    // and reservePaidPlacesCall against the same ten-connection application pool.
    await pool.query(`
      CREATE TABLE crawler_progress (id integer PRIMARY KEY, monthly_budget_cents integer NOT NULL);
      INSERT INTO crawler_progress VALUES (1, 3000);
      CREATE TABLE restaurant_import_runs (
        id serial PRIMARY KEY, cities text[] NOT NULL, requested integer NOT NULL,
        imported integer NOT NULL, skipped_duplicates integer NOT NULL,
        api_calls integer NOT NULL, estimated_cost_cents integer NOT NULL,
        monthly_budget_cents integer NOT NULL, stopped_because text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    const realBundle = path.join(bundleDir, "real.mjs");
    await build({
      entryPoints: [path.resolve(import.meta.dirname, "placePhotoLookup.ts")],
      outfile: realBundle, bundle: true, platform: "node", format: "esm", packages: "external",
    });
    const real = await import(pathToFileURL(realBundle).href);
    globalThis.fetch = async (url) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(JSON.stringify(String(url).includes("/media?")
        ? { photoUri: "https://images.example/real" }
        : { photos: [{ name: "places/real/photos/first" }] }));
    };
    const saturated = Array.from({ length: 10 }, (_, n) => real.getPlacePhotos(`real-${n}`, "key", 1));
    let timeout;
    let results;
    try {
      results = await Promise.race([
        Promise.all(saturated),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Reservation pool deadlocked")), 8000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    assert.equal(results.length, 10);
    assert.ok(results.every((photos) => photos[0].url === "https://images.example/real"));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM restaurant_import_runs")).rows[0].n, 11);
  } finally {
    globalThis.photoDelay = null;
    globalThis.fetch = originalFetch;
    if (pool) await pool.end();
    if (saved.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.DATABASE_URL;
    if (saved.NEON_DATABASE_URL === undefined) delete process.env.NEON_DATABASE_URL;
    else process.env.NEON_DATABASE_URL = saved.NEON_DATABASE_URL;
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(bundleDir, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});