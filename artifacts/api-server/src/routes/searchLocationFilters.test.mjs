import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const apiRoot = path.resolve(import.meta.dirname, "../..");

const dbMock = String.raw`
const columns = [
  "placeId", "slug", "name", "address", "city", "region", "country",
  "globalRegion", "cuisineTags", "dietaryTags", "rating", "premium",
  "qualificationScore", "popularity", "aiRelevanceBoost", "importedAt",
];
export const restaurantsTable = Object.fromEntries(
  columns.map((column) => [column, { kind: "column", column }]),
);
export const restaurantSearchEventsTable = {};
const state = () => globalThis.__searchLocationState;
const value = (expression, row) =>
  expression?.kind === "column" ? row[expression.column] : undefined;
const matches = (condition, row) => {
  if (!condition) return true;
  if (condition.kind === "and") {
    return condition.conditions.every((child) => matches(child, row));
  }
  if (condition.kind === "exactInsensitive") {
    return String(value(condition.column, row) ?? "").toLowerCase()
      === String(condition.expected).toLowerCase();
  }
  if (condition.kind === "ilike") {
    const expected = condition.pattern.replaceAll("%", "").toLowerCase();
    return String(value(condition.column, row) ?? "").toLowerCase().includes(expected);
  }
  if (condition.kind === "eq") return value(condition.column, row) === condition.expected;
  return true;
};
export const db = {
  select() {
    return {
      from() {
        let condition;
        return {
          where(next) { condition = next; return this; },
          orderBy() {
            return {
              async limit(limit) {
                return state().rows.filter((row) => matches(condition, row)).slice(0, limit);
              },
            };
          },
        };
      },
    };
  },
  insert() {
    return { async values() {} };
  },
};
`;

const ormMock = String.raw`
export const and = (...conditions) => ({ kind: "and", conditions });
export const desc = (expression) => ({ kind: "desc", expression });
export const eq = (column, expected) => ({ kind: "eq", column, expected });
export const gte = (column, expected) => ({ kind: "gte", column, expected });
export const ilike = (column, pattern) => ({ kind: "ilike", column, pattern });
export const or = (...conditions) => ({ kind: "or", conditions });
export const sql = (strings, ...values) => {
  const text = strings.join(" ");
  if (text.includes("lower(") && text.includes(" = lower(")) {
    return { kind: "exactInsensitive", column: values[0], expected: values[1] };
  }
  return { kind: "sql" };
};
`;

const expressMock = String.raw`
export function Router() {
  return {
    stack: [],
    get(path, ...handles) {
      this.stack.push({ route: { path, stack: handles.map((handle) => ({ handle })) } });
      return this;
    },
  };
}
`;

const rateLimitMock = String.raw`
export default function rateLimit() {
  return (_req, _res, next) => next();
}
`;

const servicesMock = String.raw`
export async function scoreSearchRelevance() { return null; }
export function calculateRanking() { return 0; }
export async function logEvent() {}
export async function getVisitorProfile() { return null; }
export function personaliseSearch(rows) { return rows; }
`;

const tempDir = await mkdtemp(path.join(os.tmpdir(), "search-location-"));
const output = path.join(tempDir, "search.mjs");
await build({
  entryPoints: [path.join(apiRoot, "src/routes/search.ts")],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "search-location-mocks",
    setup(pluginBuild) {
      pluginBuild.onResolve(
        { filter: /^@workspace\/db$|^drizzle-orm$|^express$|^express-rate-limit$/ },
        (args) => ({ path: args.path, namespace: "search-mock" }),
      );
      pluginBuild.onResolve(
        { filter: /services\/(searchRelevanceService|rankingEngine|analyticsEngine|personalisationEngine)$/ },
        () => ({ path: "services", namespace: "search-mock" }),
      );
      pluginBuild.onLoad({ filter: /.*/, namespace: "search-mock" }, (args) => ({
        contents:
          args.path === "@workspace/db"
            ? dbMock
            : args.path === "drizzle-orm"
              ? ormMock
              : args.path === "express"
                ? expressMock
                : args.path === "express-rate-limit"
                  ? rateLimitMock
                  : servicesMock,
        loader: "js",
      }));
    },
  }],
  logLevel: "silent",
});

const router = (await import(pathToFileURL(output).href)).default;

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const searchHandler = router.stack
  .find((entry) => entry.route?.path === "/search")
  .route.stack.at(-1).handle;

async function request(query) {
  let statusCode = 200;
  let payload;
  const response = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  await searchHandler(
    {
      query,
      get() { return undefined; },
      log: { warn() {}, error() {} },
    },
    response,
  );
  return { statusCode, payload };
}

test.beforeEach(() => {
  globalThis.__searchLocationState = {
    rows: [
      {
        placeId: "cardiff",
        slug: "cardiff-cafe-1",
        name: "Cardiff Cafe",
        address: "1 High Street",
        city: "Cardiff",
        region: "Wales",
        country: "United Kingdom",
        globalRegion: "Europe",
        cuisineTags: ["British"],
        dietaryTags: [],
        rating: 4.5,
        premium: false,
        qualificationScore: 8,
        popularity: 5,
        aiRelevanceBoost: null,
        importedAt: new Date("2026-01-01"),
      },
      {
        placeId: "london",
        slug: "london-cafe-1",
        name: "London Cafe",
        address: "2 High Street",
        city: "London",
        region: "England",
        country: "United Kingdom",
        globalRegion: "Europe",
        cuisineTags: ["British"],
        dietaryTags: [],
        rating: 4.4,
        premium: false,
        qualificationScore: 8,
        popularity: 5,
        aiRelevanceBoost: null,
        importedAt: new Date("2026-01-01"),
      },
    ],
  };
});

test("region filtering is exact and case-insensitive", async () => {
  const exact = await request({ region: "wAlEs" });
  assert.deepEqual(exact.payload.results.map((row) => row.id), ["cardiff"]);

  const partial = await request({ region: "wal" });
  assert.deepEqual(partial.payload.results, []);
});

test("country filtering is exact and case-insensitive", async () => {
  const exact = await request({ country: "uNiTeD kInGdOm" });
  assert.deepEqual(
    exact.payload.results.map((row) => row.id),
    ["cardiff", "london"],
  );

  const partial = await request({ country: "kingdom" });
  assert.deepEqual(partial.payload.results, []);
});