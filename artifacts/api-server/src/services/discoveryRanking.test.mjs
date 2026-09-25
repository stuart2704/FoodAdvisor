import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const apiRoot = path.resolve(import.meta.dirname, "../..");
const mockDb = String.raw`
const columns = [
  "placeId", "city", "cuisineTags", "premium", "rankingScore",
  "rating", "name", "popularity",
];
export const restaurantsTable = Object.fromEntries(
  columns.map((column) => [column, { column }]),
);
export const analyticsEventsTable = {};
const field = (expression, row) => row[expression.column];
const matches = (condition, row) => {
  if (!condition) return true;
  if (condition.kind === "and") return condition.conditions.every((part) => matches(part, row));
  if (condition.kind === "eq") return field(condition.column, row) === condition.value;
  if (condition.kind === "ne") return field(condition.column, row) !== condition.value;
  if (condition.kind === "gt") return field(condition.column, row) > condition.value;
  return true; // The city/cuisine SQL predicates are satisfied by every fixture.
};
export const db = {
  select() {
    let condition;
    let orders = [];
    const query = {
      from() { return query; },
      where(value) { condition = value; return query; },
      orderBy(...value) { orders = value; return query; },
      async limit(count) {
        return globalThis.__discoveryRows
          .filter((row) => matches(condition, row))
          .sort((left, right) => {
            for (const order of orders) {
              const expression = order.expression ?? order;
              const a = field(expression, left);
              const b = field(expression, right);
              const difference = typeof a === "string"
                ? a.localeCompare(b)
                : (a ?? -Infinity) - (b ?? -Infinity);
              if (difference) return order.direction === "desc" ? -difference : difference;
            }
            return 0;
          })
          .slice(0, count);
      },
    };
    return query;
  },
};
`;
const mockOrm = String.raw`
export const desc = (expression) => ({ expression, direction: "desc" });
export const eq = (column, value) => ({ kind: "eq", column, value });
export const ne = (column, value) => ({ kind: "ne", column, value });
export const gt = (column, value) => ({ kind: "gt", column, value });
export const and = (...conditions) => ({ kind: "and", conditions });
export const inArray = () => ({ kind: "sql" });
export const sql = () => ({ kind: "sql" });
`;

async function loadEngines() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "discovery-ranking-"));
  const entries = ["cityPageEngine", "cuisinePageEngine", "homepageEngine", "recommendationEngine"];
  try {
    await build({
      entryPoints: entries.map((name) => path.join(apiRoot, `src/services/${name}.ts`)),
      outdir: temp,
      bundle: true,
      format: "esm",
      platform: "node",
      plugins: [{
        name: "discovery-db-mock",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$/ }, (args) => ({
            path: args.path,
            namespace: "discovery-mock",
          }));
          pluginBuild.onLoad({ filter: /.*/, namespace: "discovery-mock" }, (args) => ({
            contents: args.path === "@workspace/db" ? mockDb : mockOrm,
            loader: "js",
          }));
        },
      }],
      logLevel: "silent",
    });
    return {
      city: (await import(pathToFileURL(path.join(temp, "cityPageEngine.js")).href)).getCityPage,
      cuisine: (await import(pathToFileURL(path.join(temp, "cuisinePageEngine.js")).href)).getCuisinePage,
      home: (await import(pathToFileURL(path.join(temp, "homepageEngine.js")).href)).getHomepageData,
      recommendations: await import(pathToFileURL(path.join(temp, "recommendationEngine.js")).href),
      cleanup: () => rm(temp, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

const engines = await loadEngines();
test.after(engines.cleanup);

function restaurant(id, overrides = {}) {
  return {
    placeId: id,
    name: id,
    city: "Bath",
    country: "United Kingdom",
    cuisineTags: ["French"],
    dietaryTags: [],
    types: [],
    rating: 4,
    premium: false,
    qualificationScore: 0,
    popularity: 0,
    aiRelevanceBoost: 0,
    rankingScore: 0,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}
const ids = (rows) => rows.map((row) => row.id ?? row.placeId);

// The common ranking formula gives Premium 50 points, not an absolute first position.
// 40 + 0.3 * 30 = 49; 40 + 0.3 * 40 = 52.
const boundedRows = [
  restaurant("basic-52", { qualificationScore: 100, popularity: 40 }),
  restaurant("premium-50", { premium: true }),
  restaurant("basic-49", { qualificationScore: 100, popularity: 30 }),
  restaurant("basic-40", { qualificationScore: 100, popularity: 0 }),
];
const boundedOrder = ["basic-52", "premium-50", "basic-49", "basic-40"];

function dailyIds(rows, prefix) {
  const day = new Date().toISOString().slice(0, 10);
  return ids(rows).sort((left, right) => {
    const hash = (id) => createHash("sha256").update(`${day}:${prefix}${id}`).digest("hex");
    return hash(left).localeCompare(hash(right));
  });
}

test("city sections use the 50-point Premium boundary without losing relevance or popularity", async () => {
  globalThis.__discoveryRows = boundedRows;
  const page = await engines.city("Bath");
  assert.deepEqual(ids(page.top), boundedOrder);
  assert.deepEqual(ids(page.cuisineSections.French), boundedOrder);
  assert.deepEqual(ids(page.trending), ["basic-52", "basic-49"]);
  assert.deepEqual(ids(page.premium), ["premium-50"]);
  assert.deepEqual(ids(page.discovery), dailyIds(boundedRows, "Bath:"));
});

test("cuisine sections use the same bounded Premium priority and daily discovery order", async () => {
  globalThis.__discoveryRows = boundedRows;
  const page = await engines.cuisine("French");
  assert.deepEqual(ids(page.top), boundedOrder);
  assert.deepEqual(ids(page.citySections.Bath), boundedOrder);
  assert.deepEqual(ids(page.trending), ["basic-52", "basic-49"]);
  assert.deepEqual(ids(page.premium), ["premium-50"]);
  assert.deepEqual(ids(page.discovery), dailyIds(boundedRows, "French:"));
});

test("homepage featured, highlights and trending keep the bounded boost and popularity filter", async () => {
  globalThis.__discoveryRows = boundedRows.map((row) => ({
    ...row, city: "London", cuisineTags: ["Italian"],
  }));
  const page = await engines.home();
  assert.deepEqual(ids(page.featured), boundedOrder);
  assert.deepEqual(ids(page.cityHighlights.London), boundedOrder);
  assert.deepEqual(ids(page.cuisineHighlights.Italian), boundedOrder);
  assert.deepEqual(ids(page.trending), ["basic-52", "basic-49"]);
  assert.deepEqual(ids(page.premium), ["premium-50"]);
  assert.deepEqual(ids(page.globalDiscovery), dailyIds(boundedRows, ""));
});

test("equal city, cuisine and homepage scores use database rating then name ties", async () => {
  globalThis.__discoveryRows = [
    restaurant("z", { name: "Zed", rating: 5, qualificationScore: 50 }),
    restaurant("b", { name: "Beta", rating: 5, qualificationScore: 50 }),
    restaurant("a", { name: "Alpha", rating: 4, qualificationScore: 50 }),
  ];
  assert.deepEqual(ids((await engines.city("Bath")).top), ["b", "z", "a"]);
  assert.deepEqual(ids((await engines.cuisine("French")).top), ["b", "z", "a"]);
  assert.deepEqual(ids((await engines.home()).featured), ["b", "z", "a"]);
});

test("visitor recommendations put Premium first, then preference relevance, rating and name", async () => {
  globalThis.__discoveryRows = [
    restaurant("basic", { qualificationScore: 100, popularity: 100, aiRelevanceBoost: 100 }),
    restaurant("premium-unmatched", { premium: true }),
    restaurant("premium-clicked", { premium: true }),
    restaurant("premium-city", { premium: true, city: "Bristol" }),
    restaurant("premium-cuisine", { premium: true, cuisineTags: ["Italian"] }),
  ];
  const profile = {
    preferredCities: ["BRISTOL"],
    preferredCuisines: ["ITALIAN"],
    recentClicks: ["premium-clicked"],
  };
  const ranked = await engines.recommendations.getRecommendedForVisitor(profile);
  assert.deepEqual(ids(ranked), [
    "premium-clicked", "premium-cuisine", "premium-city", "premium-unmatched", "basic",
  ]);
  assert.deepEqual(ranked.map((row) => row.finalScore), [70, 70, 60, 50, 100]);

  globalThis.__discoveryRows = [
    restaurant("z", { name: "Zed", premium: true, rating: 4 }),
    restaurant("b", { name: "Beta", premium: true, rating: 5 }),
    restaurant("a", { name: "Alpha", premium: true, rating: 5 }),
  ];
  assert.deepEqual(ids(await engines.recommendations.getRecommendedForVisitor({
    preferredCities: [], preferredCuisines: [], recentClicks: [],
  })), ["a", "b", "z"]);
});

test("similar and top-cuisine recommendations keep Premium first; city trending stays popularity-first", async () => {
  globalThis.__discoveryRows = [
    restaurant("source"),
    restaurant("basic-high", { qualificationScore: 100, popularity: 100, rating: 5 }),
    restaurant("premium-low", { premium: true, rating: 3, popularity: 25 }),
    restaurant("premium-high", { premium: true, qualificationScore: 50, rating: 4, popularity: 22 }),
  ];
  assert.deepEqual(ids(await engines.recommendations.getSimilarRestaurants("source")),
    ["premium-high", "premium-low", "basic-high"]);
  assert.deepEqual(ids(await engines.recommendations.getTopCuisine("French")),
    ["premium-high", "premium-low", "basic-high", "source"]);
  assert.deepEqual(ids(await engines.recommendations.getTrending("Bath")),
    ["basic-high", "premium-low", "premium-high"]);
});

test("top cuisine and city trending break equal scores by name, not by insertion order", async () => {
  globalThis.__discoveryRows = [
    restaurant("z", { name: "Zed", premium: true, popularity: 24 }),
    restaurant("a", { name: "Alpha", premium: true, popularity: 24 }),
    restaurant("basic", { name: "Basic", popularity: 24 }),
  ];
  assert.deepEqual(ids(await engines.recommendations.getTopCuisine("French")),
    ["a", "z", "basic"]);
  assert.deepEqual(ids(await engines.recommendations.getTrending("Bath")),
    ["a", "basic", "z"]);
});