import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-lookup-"));
const outfile = path.join(directory, "lookup.mjs");
await build({
  entryPoints: [path.resolve(import.meta.dirname, "placePhotoLookup.ts")],
  outfile, bundle: true, platform: "node", format: "esm",
  plugins: [{
    name: "budget-fixture",
    setup(builder) {
      builder.onResolve({ filter: /budgetedPlacesFetch$/ }, () => ({ path: "budget", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: `
          export class PlacesBudgetExceededError extends Error {
            constructor() { super("Budget exhausted"); this.name = "PlacesBudgetExceededError"; }
          }
          export async function budgetedPlacesFetch(url) {
            globalThis.photoCalls.push(url);
            if (globalThis.exhausted) throw new PlacesBudgetExceededError();
            if (url.includes("/media?")) return new Response(JSON.stringify({ photoUri: "https://images.example/photo" }));
            const place = url.endsWith("/blocked") ? "blocked" : "one";
            return new Response(JSON.stringify({ photos: [
              { name: "places/" + place + "/photos/first", authorAttributions: [{ displayName: "Photographer", uri: "https://example.com/credit" }] },
              { name: "places/" + place + "/photos/second" }
            ] }));
          }
        `,
        loader: "js",
      }));
    },
  }],
});
const { getPlacePhotos } = await import(pathToFileURL(outfile).href);
test.after(async () => rm(directory, { recursive: true, force: true }));

test("concurrent list and detail requests share billable calls and retain attribution", async () => {
  globalThis.photoCalls = [];
  globalThis.exhausted = false;
  const [card, detail] = await Promise.all([
    getPlacePhotos("one", "unused", 1),
    getPlacePhotos("one", "unused", 1),
  ]);
  assert.deepEqual(card, detail);
  assert.equal(card[0].attribution[0].displayName, "Photographer");
  assert.equal(globalThis.photoCalls.length, 2); // One details call, one media call.
  await getPlacePhotos("one", "unused", 1);
  assert.equal(globalThis.photoCalls.length, 2);
  await getPlacePhotos("one", "unused", 6);
  assert.equal(globalThis.photoCalls.length, 3); // Only the second media call is new.
});

test("exhausted allowance never falls through to a paid request or caches failure", async () => {
  globalThis.photoCalls = [];
  globalThis.exhausted = true;
  await assert.rejects(getPlacePhotos("blocked", "unused", 1), { name: "PlacesBudgetExceededError" });
  assert.equal(globalThis.photoCalls.length, 1);
  globalThis.exhausted = false;
  await getPlacePhotos("blocked", "unused", 1);
  assert.equal(globalThis.photoCalls.length, 3);
});