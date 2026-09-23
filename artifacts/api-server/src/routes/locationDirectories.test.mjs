import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { restaurantSlug, slugify } from "../utils/slugify.ts";

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
const state = () => globalThis.__locationDirectoryState;
const value = (expression, row) =>
  expression?.kind === "column" ? row[expression.column] : undefined;
const matches = (condition, row) => {
  if (!condition) return true;
  if (condition.kind === "eq") return value(condition.column, row) === condition.expected;
  if (condition.kind === "notNull") return value(condition.column, row) != null;
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
  const chain = {
    from() { return chain; },
    where(next) { condition = next; return chain; },
    groupBy(next) { groupColumn = next; return chain; },
    orderBy(...next) { orders = next; return chain; },
    async limit(limit) {
      let rows = state().rows.filter((row) => matches(condition, row));
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
export const db = {
  select: (selection) => query(selection),
  selectDistinct: (selection) => query(selection, true),
};
export const cityPageViewEventsTable = {};
`;

const ormMock = String.raw`
export const asc = (expression) => ({ direction: "asc", expression });
export const desc = (expression) => ({ direction: "desc", expression });
export const eq = (column, expected) => ({ kind: "eq", column, expected });
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
  };
}
`;

const cacheMock = String.raw`
export const cache = { get() { return undefined; }, set() {} };
`;

const cityPageMock = String.raw`
export async function getCityPage() { throw new Error("not used"); }
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

const [cityBundle, regionBundle] = await Promise.all([
  loadRouter("city"),
  loadRouter("regions"),
]);

test.after(async () => {
  await Promise.all([cityBundle.cleanup(), regionBundle.cleanup()]);
});

function handler(router, routePath) {
  return router.stack.find((entry) => entry.route?.path === routePath)
    .route.stack[0].handle;
}

async function request(routeHandler, params = {}) {
  let statusCode = 200;
  let payload;
  const response = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  const log = { error() {}, warn() {} };
  await routeHandler({ params, log }, response);
  return { statusCode, payload };
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
  globalThis.__locationDirectoryState = { rows };
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