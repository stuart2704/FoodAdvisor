import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { locationSlugs, restaurantSlug, slugify } from "../utils/slugify.ts";

const apiRoot = path.resolve(import.meta.dirname, "../..");

const dbMock = String.raw`
const columns = [
  "placeId", "slug", "name", "address", "city", "region", "country",
  "globalRegion", "cuisineTags", "dietaryTags", "rating", "priceLevel",
  "website", "googleMapsUrl", "premium", "rankingScore",
];
export const restaurantsTable = Object.fromEntries(
  columns.map((column) => [column, { kind: "column", column }]),
);
export const locationSlugAliasesTable = {
  kind: { kind: "column", column: "kind" },
  slug: { kind: "column", column: "slug" },
  targetName: { kind: "column", column: "targetName" },
  source: "aliases",
};
restaurantsTable.source = "restaurants";
const state = () => globalThis.__locationDirectoryState;
const value = (expression, row) =>
  expression?.kind === "column" ? row[expression.column] : undefined;
const matches = (condition, row) => {
  if (!condition) return true;
  if (condition.kind === "eq") return value(condition.column, row) === condition.expected;
  if (condition.kind === "notNull") return value(condition.column, row) != null;
  if (condition.kind === "and") return condition.conditions.every((item) => matches(item, row));
  return true;
};
const project = (selection, row) => Object.fromEntries(
  Object.entries(selection).map(([key, expression]) => [
    key,
    expression?.kind === "count" ? undefined : value(expression, row),
  ]),
);
const grouped = (selection, rows, groupColumn) => {
  const groups = new Map();
  for (const row of rows) {
    const key = value(groupColumn, row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => Object.fromEntries(
    Object.entries(selection).map(([key, expression]) => [
      key,
      expression?.kind === "count" ? group.length : value(expression, group[0]),
    ]),
  ));
};
function query(selection, distinct = false) {
  let condition;
  let groupColumn;
  let orders = [];
  let source = "restaurants";
  const chain = {
    from(table) { source = table.source; return chain; },
    where(next) { condition = next; return chain; },
    groupBy(next) { groupColumn = next; return chain; },
    orderBy(...next) { orders = next; return chain; },
    async limit(limit) {
       let rows = (source === "aliases" ? (state().aliases ?? []) : state().rows)
         .filter((row) => matches(condition, row));
      if (distinct) {
        const key = Object.keys(selection)[0];
        const seen = new Set();
        rows = rows.filter((row) => {
          const candidate = value(selection[key], row);
          if (seen.has(candidate)) return false;
          seen.add(candidate);
          return true;
        });
      }
      let result = groupColumn
        ? grouped(selection, rows, groupColumn)
        : rows.map((row) => project(selection, row));
      for (const order of orders.reverse()) {
        const key = Object.entries(selection).find(([, expression]) =>
          expression === order.expression)?.[0];
        if (key) result.sort((a, b) => String(a[key]).localeCompare(String(b[key])));
      }
      return result.slice(0, limit);
    },
  };
  return chain;
}
function mutation(table, operation) {
  let patch;
  let condition;
  let onConflict = false;
  const chain = {
    set(value) { patch = value; return chain; },
    values(value) { patch = value; return chain; },
    onConflictDoUpdate() { onConflict = true; return chain; },
    where(value) { condition = value; return chain; },
    async returning(selection) {
      const records = table.source === "aliases" ? state().aliases : state().rows;
      if (operation === "insert") {
        records.push(patch);
        return [project(selection, patch)];
      }
      const selected = records.filter((row) => matches(condition, row));
      for (const row of selected) Object.assign(row, patch);
      return selected.map((row) => project(selection, row));
    },
    then(resolve, reject) {
      if (operation === "insert") {
        const records = table.source === "aliases" ? state().aliases : state().rows;
        const existing = onConflict && records.find((row) => row.kind === patch.kind && row.slug === patch.slug);
        if (existing) Object.assign(existing, patch);
        else records.push(patch);
      } else {
        const records = table.source === "aliases" ? state().aliases : state().rows;
        for (const row of records.filter((candidate) => matches(condition, candidate))) {
          Object.assign(row, patch);
        }
      }
      return Promise.resolve().then(() => resolve?.()).catch(reject);
    },
  };
  return chain;
}
export const db = {
  select: (selection) => query(selection),
  selectDistinct: (selection) => query(selection, true),
  update: (table) => mutation(table, "update"),
  insert: (table) => mutation(table, "insert"),
  execute: async () => {},
  transaction: async (callback) => callback(db),
};
export const cityPageViewEventsTable = {};
export const restaurantProfileViewEventsTable = {};
`;

const ormMock = String.raw`
export const asc = (expression) => ({ direction: "asc", expression });
export const desc = (expression) => ({ direction: "desc", expression });
export const eq = (column, expected) => ({ kind: "eq", column, expected });
export const and = (...conditions) => ({ kind: "and", conditions });
export const isNotNull = (column) => ({ kind: "notNull", column });
export const sql = () => ({ kind: "count", mapWith() { return this; } });
`;

const expressMock = String.raw`
export function Router() {
  return {
    stack: [],
    get(path, handle) {
      this.stack.push({ route: { path, stack: [{ handle }] } });
      return this;
    },
    put(path, ...handles) {
      this.stack.push({ route: { path, stack: [{ handle: handles.at(-1) }] } });
      return this;
    },
    post(path, ...handles) {
      this.stack.push({ route: { path, stack: [{ handle: handles.at(-1) }] } });
      return this;
    },
  };
}
`;

const cacheMock = String.raw`
export const cache = { get() { return undefined; }, set() {}, del() {} };
`;

const cityPageMock = String.raw`
export async function getCityPage() { throw new Error("not used"); }
`;

const restaurantDependenciesMock = String.raw`
export const adminOnly = (_req, _res, next) => next();
export async function getRestaurantProfile() { throw new Error("not used"); }
export async function logEvent() { throw new Error("not used"); }
`;

async function loadRouter(filename) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "location-directory-"));
  const output = path.join(tempDir, `${filename}.mjs`);
  const mocks = new Map([
    ["@workspace/db", dbMock],
    ["drizzle-orm", ormMock],
    ["express", expressMock],
    ["cache", cacheMock],
    ["city-page", cityPageMock],
    ["restaurant-dependencies", restaurantDependenciesMock],
  ]);
  await build({
    entryPoints: [path.join(apiRoot, `src/routes/${filename}.ts`)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    plugins: [{
      name: "location-directory-mocks",
      setup(pluginBuild) {
        pluginBuild.onResolve(
          { filter: /^@workspace\/db$|^drizzle-orm$|^express$/ },
          (args) => ({ path: args.path, namespace: "location-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /lib\/cache$/ },
          () => ({ path: "cache", namespace: "location-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /services\/cityPageEngine$/ },
          () => ({ path: "city-page", namespace: "location-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /services\/restaurantProfileEngine$|services\/analyticsEngine$|middleware\/adminOnly$/ },
          () => ({ path: "restaurant-dependencies", namespace: "location-mock" }),
        );
        pluginBuild.onLoad({ filter: /.*/, namespace: "location-mock" }, (args) => ({
          contents: mocks.get(args.path),
          loader: "js",
        }));
      },
    }],
    logLevel: "silent",
  });
  return {
    router: (await import(pathToFileURL(output).href)).default,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

const [cityBundle, regionBundle, countryBundle, restaurantBundle, renameBundle] = await Promise.all([
  loadRouter("city"),
  loadRouter("regions"),
  loadRouter("countries"),
  loadRouter("restaurant"),
  loadRouter("locationRename"),
]);

test.after(async () => {
  await Promise.all([cityBundle.cleanup(), regionBundle.cleanup(), countryBundle.cleanup(), restaurantBundle.cleanup(), renameBundle.cleanup()]);
});

function handler(router, routePath) {
  return router.stack.find((entry) => entry.route?.path === routePath)
    .route.stack[0].handle;
}

async function request(routeHandler, params = {}, body = undefined) {
  let statusCode = 200;
  let payload;
  let location;
  const headers = {};
  const response = {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    redirect(code, path) { statusCode = code; location = path; return this; },
  };
  const log = { error() {}, warn() {} };
  await routeHandler({ params, body, log }, response);
  return { statusCode, payload, headers, location };
}

const rows = [
  {
    placeId: "paris-1",
    slug: restaurantSlug("Chez Nous", "paris-1"),
    name: "Chez Nous",
    address: "1 Rue A",
    city: "Paris",
    region: "Île-de-France",
    country: "France",
    globalRegion: "Europe",
    cuisineTags: ["French"],
    dietaryTags: [],
    rating: 4.8,
    priceLevel: null,
    website: "https://example.com",
    googleMapsUrl: "https://maps.example/1",
    premium: true,
    rankingScore: 10,
    privateOwnerEmail: "owner@example.com",
  },
  {
    placeId: "paris-2",
    slug: restaurantSlug("Chez Nous", "paris-2"),
    name: "Chez Nous",
    address: "2 Rue B",
    city: "Paris",
    region: "Île-de-France",
    country: "France",
    globalRegion: "Europe",
    cuisineTags: ["French"],
    dietaryTags: ["Vegetarian"],
    rating: 4.5,
    priceLevel: null,
    website: null,
    googleMapsUrl: "https://maps.example/2",
    premium: false,
    rankingScore: 8,
  },
  {
    placeId: "bath-1",
    slug: restaurantSlug("Bath House", "bath-1"),
    name: "Bath House",
    address: "1 High Street",
    city: "Bath",
    region: null,
    country: null,
    globalRegion: null,
    cuisineTags: ["British"],
    dietaryTags: [],
    rating: 4.2,
    priceLevel: null,
    website: null,
    googleMapsUrl: null,
    premium: false,
    rankingScore: 5,
  },
];

test.beforeEach(() => {
  globalThis.__locationDirectoryState = { rows: structuredClone(rows), aliases: [] };
});

test("Unicode location slugs retain their published form and duplicate restaurant names stay unique", () => {
  // Keep this legacy result stable: changing it would break published location URLs.
  assert.equal(slugify("Île-de-France"), "le-de-france");
  assert.notEqual(rows[0].slug, rows[1].slug);
  assert.match(rows[0].slug, /^chez-nous-[a-f0-9]{10}$/);
});

test("city list returns exact counts and keeps unmapped cities", async () => {
  const result = await request(handler(cityBundle.router, "/cities"));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, [
    { city: "Bath", slug: "bath", count: 1 },
    { city: "Paris", slug: "paris", count: 2 },
  ]);
});

test("canonical city slug resolves public restaurant data only", async () => {
  const result = await request(
    handler(cityBundle.router, "/cities/:slug"),
    { slug: "paris" },
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.city, "Paris");
  assert.equal(result.headers.link, '</api/cities/paris>; rel="canonical"');
  assert.equal(result.payload.restaurants.length, 2);
  assert.equal("privateOwnerEmail" in result.payload.restaurants[0], false);
});

test("city detail rejects malformed and unknown slugs", async () => {
  const route = handler(cityBundle.router, "/cities/:slug");
  assert.equal((await request(route, { slug: "Paris!" })).statusCode, 400);
  assert.equal((await request(route, { slug: "missing-city" })).statusCode, 404);
});

test("region list counts mapped restaurants and excludes unmapped cities", async () => {
  const result = await request(handler(regionBundle.router, "/regions"));
  assert.deepEqual(result.payload, [
    { region: "Île-de-France", slug: "le-de-france", count: 2 },
  ]);
});

test("canonical region slug resolves only its cities", async () => {
  const result = await request(
    handler(regionBundle.router, "/regions/:slug"),
    { slug: "le-de-france" },
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers.link, '</api/regions/le-de-france>; rel="canonical"');
  assert.deepEqual(result.payload, {
    region: "Île-de-France",
    cities: [{ city: "Paris", count: 2, slug: "paris" }],
  });
});

test("region detail rejects malformed and unknown slugs", async () => {
  const route = handler(regionBundle.router, "/regions/:slug");
  assert.equal((await request(route, { slug: "Île-de-France" })).statusCode, 400);
  assert.equal((await request(route, { slug: "unknown-region" })).statusCode, 404);
});

test("old city and region slugs redirect to current canonical URLs after a rename", async () => {
  globalThis.__locationDirectoryState = {
    rows: rows.map((row) => row.city === "Paris"
      ? { ...row, city: "Grand Paris", region: "Greater Paris" } : row),
    aliases: [
      { kind: "city", slug: "paris", targetName: "Grand Paris" },
      { kind: "region", slug: "le-de-france", targetName: "Greater Paris" },
      { kind: "city", slug: "old-paris", targetName: "Grand Paris" },
    ],
  };
  for (const [router, routePath, oldSlug, path] of [
    [cityBundle.router, "/cities/:slug", "paris", "/api/cities/grand-paris"],
    [regionBundle.router, "/regions/:slug", "le-de-france", "/api/regions/greater-paris"],
    [cityBundle.router, "/cities/:slug", "old-paris", "/api/cities/grand-paris"],
  ]) {
    const result = await request(handler(router, routePath), { slug: oldSlug });
    assert.equal(result.statusCode, 308);
    assert.equal(result.location, path);
    assert.equal(result.headers.link, `<${path}>; rel="canonical"`);
  }
  const current = await request(handler(cityBundle.router, "/cities/:slug"), { slug: "grand-paris" });
  assert.equal(current.statusCode, 200);
  assert.equal(current.headers.link, '</api/cities/grand-paris>; rel="canonical"');
  const currentRegion = await request(handler(regionBundle.router, "/regions/:slug"), { slug: "greater-paris" });
  assert.equal(currentRegion.statusCode, 200);
  assert.equal(currentRegion.headers.link, '</api/regions/greater-paris>; rel="canonical"');
});

test("normal admin restaurant updates preserve the old links when the last location record moves", async () => {
  const update = handler(restaurantBundle.router, "/restaurants/:slug");
  const cityDetail = handler(cityBundle.router, "/cities/:slug");
  const regionDetail = handler(regionBundle.router, "/regions/:slug");
  for (const restaurant of rows.slice(0, 2)) {
    const result = await request(update, { slug: restaurant.slug }, { city: "Grand Paris", region: "Greater Paris" });
    assert.equal(result.statusCode, 200);
    if (restaurant === rows[0]) {
      assert.equal((await request(cityDetail, { slug: "paris" })).statusCode, 200);
      assert.equal((await request(regionDetail, { slug: "le-de-france" })).statusCode, 200);
    }
  }
  const cityOld = await request(cityDetail, { slug: "paris" });
  const regionOld = await request(regionDetail, { slug: "le-de-france" });
  assert.equal(cityOld.statusCode, 308);
  assert.equal(cityOld.location, "/api/cities/grand-paris");
  assert.equal(regionOld.statusCode, 308);
  assert.equal(regionOld.location, "/api/regions/greater-paris");
  assert.equal((await request(cityDetail, { slug: "grand-paris" })).statusCode, 200);
  assert.equal((await request(regionDetail, { slug: "greater-paris" })).statusCode, 200);

  // A second rename must retarget *all* historical links, not form a chain.
  for (const restaurant of rows.slice(0, 2)) {
    const result = await request(update, { slug: restaurant.slug }, { city: "Metro Paris", region: "Metro Region" });
    assert.equal(result.statusCode, 200);
  }
  assert.equal((await request(cityDetail, { slug: "paris" })).location, "/api/cities/metro-paris");
  assert.equal((await request(regionDetail, { slug: "le-de-france" })).location, "/api/regions/metro-region");
});

test("admin location rename changes all matching records and saves prior canonical URLs atomically", async () => {
  const rename = handler(renameBundle.router, "/admin/locations/rename");
  const cityDetail = handler(cityBundle.router, "/cities/:slug");
  const regionDetail = handler(regionBundle.router, "/regions/:slug");
  assert.equal((await request(rename, {}, { kind: "city", from: "Unknown", to: "Metro Paris" })).statusCode, 404);
  assert.equal((await request(rename, {}, { kind: "city", from: "Paris", to: "Bath" })).statusCode, 409);
  assert.equal((await request(rename, {}, { kind: "city", from: "Paris", to: "Metro Paris" })).statusCode, 200);
  assert.equal((await request(rename, {}, { kind: "region", from: "Île-de-France", to: "Greater Paris" })).statusCode, 200);
  assert.deepEqual(globalThis.__locationDirectoryState.rows.filter(row => row.city === "Metro Paris").length, 2);
  assert.equal((await request(cityDetail, { slug: "paris" })).location, "/api/cities/metro-paris");
  assert.equal((await request(regionDetail, { slug: "le-de-france" })).location, "/api/regions/greater-paris");
  assert.equal((await request(cityDetail, { slug: "metro-paris" })).statusCode, 200);
  assert.equal((await request(regionDetail, { slug: "greater-paris" })).statusCode, 200);
  assert.equal((await request(rename, {}, { kind: "city", from: "Metro Paris", to: "Paris" })).statusCode, 200);
  assert.equal((await request(rename, {}, { kind: "city", from: "Paris", to: "Metro Paris" })).statusCode, 200);
  assert.equal((await request(cityDetail, { slug: "paris" })).location, "/api/cities/metro-paris");
  assert.equal((await request(rename, {}, { kind: "region", from: "Greater Paris", to: "Île-de-France" })).statusCode, 200);
  assert.equal((await request(rename, {}, { kind: "region", from: "Île-de-France", to: "Greater Paris" })).statusCode, 200);
  assert.equal((await request(regionDetail, { slug: "le-de-france" })).location, "/api/regions/greater-paris");
});

test("renaming a colliding name keeps the unchanged location's old slug working", async () => {
  globalThis.__locationDirectoryState = { rows: [
    { ...rows[0], city: "Málaga", region: "Île-de-France" },
    { ...rows[1], city: "M-laga", region: "le-de-France" },
  ], aliases: [] };
  const rename = handler(renameBundle.router, "/admin/locations/rename");
  const cityDetail = handler(cityBundle.router, "/cities/:slug");
  const regionDetail = handler(regionBundle.router, "/regions/:slug");
  const cityBefore = locationSlugs(["Málaga", "M-laga"]);
  const regionBefore = locationSlugs(["Île-de-France", "le-de-France"]);
  assert.equal((await request(rename, {}, { kind: "city", from: "Málaga", to: "Granada" })).statusCode, 200);
  assert.equal((await request(rename, {}, { kind: "region", from: "Île-de-France", to: "Andalusia" })).statusCode, 200);
  const survivorCity = await request(cityDetail, { slug: cityBefore.get("M-laga") });
  const survivorRegion = await request(regionDetail, { slug: regionBefore.get("le-de-France") });
  assert.equal(survivorCity.location, "/api/cities/m-laga");
  assert.equal(survivorRegion.location, "/api/regions/le-de-france");
  assert.equal((await request(cityDetail, { slug: cityBefore.get("Málaga") })).location, "/api/cities/granada");
  assert.equal((await request(regionDetail, { slug: regionBefore.get("Île-de-France") })).location, "/api/regions/andalusia");
});

test("stale and wrong-kind aliases cannot resolve, and canonical matches take precedence", async () => {
  globalThis.__locationDirectoryState.aliases = [
    { kind: "city", slug: "lost", targetName: "Absent" },
    { kind: "region", slug: "regional-only", targetName: "Île-de-France" },
    { kind: "city", slug: "bath", targetName: "Paris" },
  ];
  const city = handler(cityBundle.router, "/cities/:slug");
  const region = handler(regionBundle.router, "/regions/:slug");
  assert.equal((await request(city, { slug: "lost" })).statusCode, 404);
  assert.equal((await request(city, { slug: "regional-only" })).statusCode, 404);
  assert.equal((await request(region, { slug: "lost" })).statusCode, 404);
  assert.equal((await request(city, { slug: "bad!" })).statusCode, 400);
  assert.equal((await request(region, { slug: "bad!" })).statusCode, 400);
  const canonical = await request(city, { slug: "bath" });
  assert.equal(canonical.statusCode, 200);
  assert.equal(canonical.payload.city, "Bath");
});

test("Unicode city collisions get stable distinct URLs across list, detail and nested directories", async () => {
  const collisionRows = [
    { ...rows[0], placeId: "a", city: "Málaga", region: "Île-de-France" },
    { ...rows[0], placeId: "b", city: "M-laga", region: "le-de-France" },
    { ...rows[0], placeId: "c", city: "Bath", region: "Île-de-France" },
  ];
  globalThis.__locationDirectoryState = { rows: collisionRows };
  assert.equal(slugify("Málaga"), slugify("M-laga"));
  const cityList = await request(handler(cityBundle.router, "/cities"));
  const slugs = Object.fromEntries(cityList.payload.map(({ city, slug }) => [city, slug]));
  assert.equal(slugs.Bath, "bath");
  assert.match(slugs["Málaga"], /^m-laga-[a-f0-9]{12}$/);
  assert.match(slugs["M-laga"], /^m-laga-[a-f0-9]{12}$/);
  assert.notEqual(slugs["Málaga"], slugs["M-laga"]);
  for (const city of ["Málaga", "M-laga"]) {
    const detail = await request(handler(cityBundle.router, "/cities/:slug"), { slug: slugs[city] });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.payload.city, city);
    assert.deepEqual(detail.payload.restaurants.map(({ id }) => id), [
      city === "Málaga" ? "a" : "b",
    ]);
  }
  assert.equal((await request(handler(cityBundle.router, "/cities/:slug"), { slug: "m-laga" })).statusCode, 404);
  const regionSlugs = Object.fromEntries((await request(handler(regionBundle.router, "/regions"))).payload
    .map(({ region, slug }) => [region, slug]));
  const regionDetail = await request(handler(regionBundle.router, "/regions/:slug"), {
    slug: regionSlugs["Île-de-France"],
  });
  assert.equal(regionDetail.payload.cities.find(({ city }) => city === "Málaga").slug, slugs["Málaga"]);
  const countryDetail = await request(handler(countryBundle.router, "/countries/:slug"), { slug: "france" });
  assert.equal(countryDetail.payload.cities.find(({ city }) => city === "M-laga").slug, slugs["M-laga"]);

  globalThis.__locationDirectoryState = { rows: [...collisionRows].reverse() };
  const reversed = await request(handler(cityBundle.router, "/cities"));
  assert.deepEqual(Object.fromEntries(reversed.payload.map(({ city, slug }) => [city, slug])), slugs);
});

test("Unicode region collisions resolve only their own cities, independently of row order", async () => {
  globalThis.__locationDirectoryState = { rows: [
    { ...rows[0], city: "Paris", region: "Île-de-France" },
    { ...rows[0], city: "Lyon", region: "le-de-France" },
  ] };
  assert.equal(slugify("Île-de-France"), slugify("le-de-France"));
  const list = await request(handler(regionBundle.router, "/regions"));
  const slugs = Object.fromEntries(list.payload.map(({ region, slug }) => [region, slug]));
  assert.notEqual(slugs["Île-de-France"], slugs["le-de-France"]);
  assert.match(slugs["Île-de-France"], /^le-de-france-[a-f0-9]{12}$/);
  for (const [region, city] of [["Île-de-France", "Paris"], ["le-de-France", "Lyon"]]) {
    const detail = await request(handler(regionBundle.router, "/regions/:slug"), { slug: slugs[region] });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.payload.region, region);
    assert.deepEqual(detail.payload.cities.map((entry) => entry.city), [city]);
  }
  assert.equal((await request(handler(regionBundle.router, "/regions/:slug"), { slug: "le-de-france" })).statusCode, 404);
});

test("suffixes cannot take an unrelated unsuffixed directory URL", () => {
  const first = locationSlugs(["Málaga", "M-laga"]);
  const reserved = first.get("Málaga");
  const slugs = locationSlugs(["Málaga", "M-laga", reserved]);
  assert.equal(slugs.get(reserved), reserved);
  assert.notEqual(slugs.get("Málaga"), reserved);
});