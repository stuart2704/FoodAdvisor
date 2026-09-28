import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { build } from "esbuild";

const dir = await mkdtemp(path.join(os.tmpdir(), "owner-photo-routes-"));
const outfile = path.join(dir, "photo.mjs");
await build({
  entryPoints: [path.resolve(import.meta.dirname, "photo.ts")],
  outfile, bundle: true, format: "esm", platform: "node",
  plugins: [{
    name: "fixture",
    setup(builder) {
      builder.onResolve({ filter: /^express$/ }, () => ({
        path: fileURLToPath(import.meta.resolve("express")), external: true,
      }));
      builder.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$|placePhotoLookup$|budgetedPlacesFetch$/ }, args => ({
        path: args.path, namespace: "fixture",
      }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
        loader: "js",
        contents: args.path === "@workspace/db" ? `
          const table = kind => new Proxy({kind}, {get(target,key) {return key === "kind" ? kind : {name:key};}});
          export const restaurantsTable=table("restaurant");
          export const restaurantPhotosTable=table("photos");
          export const db={select(columns) {return {
            from(table) {this.table=table; return this;},
            where() {return this;}, orderBy() {return this;}, limit() {return this;},
            then(resolve) {const s=globalThis.__ownerPhotoState; resolve(this.table.kind === "restaurant"
              ? [s.restaurant] : s.photos.map(id => ({id})));},
          };}};
        ` : args.path === "drizzle-orm" ? `
          export const eq = (...args) => args;
          export const and = (...args) => args;
          export const asc = value => value;
        ` : args.path.endsWith("placePhotoLookup") ? `
          export async function getPlacePhotos() {
            globalThis.__ownerPhotoState.googleCalls++;
            return [{url:"https://google.test/photo",attribution:[]}];
          }
        ` : "export class PlacesBudgetExceededError extends Error {}",
      }));
    },
  }],
});
const router = (await import(pathToFileURL(outfile).href)).default;
const app = express();
app.use((req, _res, next) => { req.log = { error() {} }; next(); });
app.use("/api", router);
const server = app.listen(0);
const url = `http://127.0.0.1:${server.address().port}`;

test.after(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });
test("approved owner photo wins without any Google lookup", async () => {
  globalThis.__ownerPhotoState = {
    restaurant: { sourceName: "google", sourceAttribution: null, published: true },
    photos: ["11111111-1111-1111-1111-111111111111"], googleCalls: 0,
  };
  const res = await fetch(`${url}/api/photo/place-1`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.url, "/api/storage/objects/restaurant/11111111-1111-1111-1111-111111111111");
  assert.equal(globalThis.__ownerPhotoState.googleCalls, 0);
});
test("gallery orders owner photos before Google photos", async () => {
  globalThis.__ownerPhotoState = {
    restaurant: { sourceName: "google", sourceAttribution: null, published: true },
    photos: ["11111111-1111-1111-1111-111111111111"], googleCalls: 0,
  };
  const res = await fetch(`${url}/api/photos/place-1`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.photos.length, 2);
  assert.match(body.photos[0].url, /storage\/objects\/restaurant/);
  assert.equal(body.photos[1].url, "https://google.test/photo");
  assert.equal(globalThis.__ownerPhotoState.googleCalls, 1);
});
test("unpublished restaurants never expose approved owner photos", async () => {
  globalThis.__ownerPhotoState = {
    restaurant: { sourceName: "google", sourceAttribution: null, published: false },
    photos: ["11111111-1111-1111-1111-111111111111"], googleCalls: 0,
  };
  const res = await fetch(`${url}/api/photo/place-1`);
  assert.equal(res.status, 404);
  assert.equal(globalThis.__ownerPhotoState.googleCalls, 0);
});
test("published non-Google restaurants can use approved owner photos", async () => {
  globalThis.__ownerPhotoState = {
    restaurant: { sourceName: "OSM", sourceAttribution: "OSM", published: true },
    photos: ["11111111-1111-1111-1111-111111111111"], googleCalls: 0,
  };
  const res = await fetch(`${url}/api/photo/osm%3Anode%2F1`);
  assert.equal(res.status, 200);
  assert.equal(globalThis.__ownerPhotoState.googleCalls, 0);
});