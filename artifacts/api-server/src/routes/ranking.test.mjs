import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import {
  PREMIUM_NEARBY_BOOST_MILES,
  premiumAdjustedDistanceMiles,
} from "../lib/restaurant-ranking.ts";

const apiRoot = path.resolve(import.meta.dirname, "../..");

const dbMock = String.raw`
const table = (columns) => Object.fromEntries(
  columns.map((column) => [column, { kind: "column", column }]),
);
export const restaurantsTable = table([
  "placeId", "premium", "importedAt", "city", "latitude", "longitude",
]);

const state = () => globalThis.__rankingRouteState;
const value = (expression, row) => {
  if (expression.kind === "column") return row[expression.column];
  if (expression.kind === "distance") return row.distanceMiles;
  if (expression.kind === "premiumAdjustedDistance") {
    const distance = value(expression.distance, row);
    const receivesBoost = value(expression.premiumColumn, row);
    return Math.max(0, distance - (receivesBoost ? expression.boostMiles : 0));
  }
  return undefined;
};
const matches = (condition, row) => {
  if (!condition) return true;
  if (condition.kind === "and") {
    return condition.conditions.every((child) => matches(child, row));
  }
  if (condition.kind === "eq") return value(condition.column, row) === condition.expected;
  if (condition.kind === "notNull") return value(condition.column, row) != null;
  if (condition.kind === "withinRadius") return row.distanceMiles <= condition.radiusMiles;
  return true;
};
const compare = (left, right, orders) => {
  for (const order of orders) {
    const leftValue = value(order.expression, left);
    const rightValue = value(order.expression, right);
    if (leftValue < rightValue) return order.direction === "asc" ? -1 : 1;
    if (leftValue > rightValue) return order.direction === "asc" ? 1 : -1;
  }
  return 0;
};
const project = (selection, row) => selection.restaurant
  ? { restaurant: row, distanceMiles: row.distanceMiles }
  : row;

export const db = {
  select(selection) {
    const selected = selection ?? restaurantsTable;
    return {
      from() {
        let condition;
        return {
          where(nextCondition) {
            condition = nextCondition;
            return this;
          },
          orderBy(...orders) {
            const sorted = state().rows
              .filter((row) => matches(condition, row))
              .sort((left, right) => compare(left, right, orders));
            return {
              async limit(limit) {
                return sorted.slice(0, limit).map((row) => project(selected, row));
              },
            };
          },
        };
      },
    };
  },
};
`;

const ormMock = String.raw`
export const asc = (expression) => ({ direction: "asc", expression });
export const desc = (expression) => ({ direction: "desc", expression });
export const eq = (column, expected) => ({ kind: "eq", column, expected });
export const isNotNull = (column) => ({ kind: "notNull", column });
export const and = (...conditions) => ({ kind: "and", conditions });
export const sql = (strings, ...values) => {
  const text = strings.join(" ");
  if (text.includes("3958.7613")) return { kind: "distance" };
  if (text.includes("case") && text.includes("when") && text.includes("else 0")) {
    return {
      kind: "premiumAdjustedDistance",
      distance: values[0],
      premiumColumn: values[1],
      boostMiles: values[2],
    };
  }
  if (text.includes("<=")) {
    return { kind: "withinRadius", radiusMiles: values.at(-1) };
  }
  return { kind: "sql" };
};
`;

const zodMock = String.raw`
const query = {
  safeParse(value) {
    const latitude = Number(value?.latitude);
    const longitude = Number(value?.longitude);
    const radiusMiles = Number(value?.radiusMiles);
    if (![latitude, longitude, radiusMiles].every(Number.isFinite)) {
      return { success: false, error: { message: "invalid query" } };
    }
    return { success: true, data: { latitude, longitude, radiusMiles } };
  },
};
export const ListNearbyRestaurantsQueryParams = query;
export const ListNearbyRestaurantsResponse = { parse: (value) => value };
export const ListRestaurantsQueryParams = {
  safeParse: (value) => ({ success: true, data: { city: value?.city } }),
};
export const ListRestaurantsResponse = { parse: (value) => value };
export const CreateRestaurantImportPlanBody = {};
export const CreateRestaurantImportPlanResponse = {};
export const GetRestaurantImportStatusResponse = {};
export const RunRestaurantImportBody = {};
export const RunRestaurantImportResponse = {};
`;

const expressMock = String.raw`
export function Router() {
  return {
    stack: [],
    get(path, handle) {
      this.stack.push({ route: { path, stack: [{ handle }] } });
      return this;
    },
    post() {
      return this;
    },
  };
}
`;

const importMock = String.raw`
export async function createImportPlan() {}
export async function getImportStatus() {}
export async function runImport() {}
`;

const responseMock = String.raw`
export function toRestaurantResponse(restaurant, distanceMiles) {
  return {
    id: restaurant.placeId,
    premium: restaurant.premium,
    ...(distanceMiles === undefined ? {} : { distanceMiles }),
  };
}
`;

async function loadRouter(filename) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ranking-route-"));
  const output = path.join(tempDir, `${filename}.mjs`);
  const mocks = new Map([
    ["@workspace/db", dbMock],
    ["drizzle-orm", ormMock],
    ["@workspace/api-zod", zodMock],
    ["express", expressMock],
    ["restaurant-import", importMock],
    ["restaurant-response", responseMock],
  ]);
  await build({
    entryPoints: [path.join(apiRoot, `src/routes/${filename}.ts`)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    plugins: [{
      name: "ranking-route-mocks",
      setup(pluginBuild) {
        pluginBuild.onResolve(
          { filter: /^@workspace\/(db|api-zod)$|^drizzle-orm$|^express$/ },
          (args) => ({ path: args.path, namespace: "ranking-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /lib\/restaurant-import$/ },
          () => ({ path: "restaurant-import", namespace: "ranking-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /lib\/restaurant-response$/ },
          () => ({ path: "restaurant-response", namespace: "ranking-mock" }),
        );
        pluginBuild.onLoad({ filter: /.*/, namespace: "ranking-mock" }, (args) => ({
          contents: mocks.get(args.path),
          loader: "js",
        }));
      },
    }],
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(output).href);
  return {
    router: module.default,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

const [directoryBundle, nearbyBundle] = await Promise.all([
  loadRouter("restaurant-import"),
  loadRouter("nearby"),
]);

function handler(router, routePath) {
  return router.stack.find((entry) => entry.route?.path === routePath)
    .route.stack[0].handle;
}

async function request(routeHandler, query) {
  let statusCode = 200;
  let payload;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
  };
  await routeHandler({ query }, response);
  return { statusCode, payload };
}

const directoryHandler = handler(directoryBundle.router, "/restaurants");
const nearbyHandler = handler(nearbyBundle.router, "/restaurants/nearby");

test.after(async () => {
  await Promise.all([directoryBundle.cleanup(), nearbyBundle.cleanup()]);
});

test("Premium nearby adjustment is exactly one mile and never negative", () => {
  assert.equal(PREMIUM_NEARBY_BOOST_MILES, 1);
  assert.equal(premiumAdjustedDistanceMiles(1.99, true), 0.99);
  assert.equal(premiumAdjustedDistanceMiles(0.5, true), 0);
  assert.equal(premiumAdjustedDistanceMiles(1.99, false), 1.99);
});

test("general restaurant results put active Premium listings before Basic listings", async () => {
  globalThis.__rankingRouteState = {
    rows: [
      { placeId: "basic", premium: false, importedAt: new Date("2026-09-23") },
      { placeId: "premium", premium: true, importedAt: new Date("2020-01-01") },
    ],
  };

  const result = await request(directoryHandler, {});

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.map((row) => row.id), ["premium", "basic"]);
});

test("general Basic-only ordering is deterministic when import times tie", async () => {
  globalThis.__rankingRouteState = {
    rows: [
      { placeId: "basic-b", premium: false, importedAt: new Date("2026-09-23") },
      { placeId: "basic-a", premium: false, importedAt: new Date("2026-09-23") },
    ],
  };

  const result = await request(directoryHandler, {});

  assert.deepEqual(result.payload.map((row) => row.id), ["basic-a", "basic-b"]);
});

test("nearby results apply a one-mile Premium boost without overriding proximity", async () => {
  globalThis.__rankingRouteState = {
    rows: [
      { placeId: "boosted-premium", premium: true, latitude: 1, longitude: 1, distanceMiles: 1.3 },
      { placeId: "near-basic", premium: false, latitude: 1, longitude: 1, distanceMiles: 0.4 },
      { placeId: "closest-basic", premium: false, latitude: 1, longitude: 1, distanceMiles: 0.2 },
    ],
  };

  const result = await request(nearbyHandler, {
    latitude: "0",
    longitude: "0",
    radiusMiles: "5",
  });

  assert.deepEqual(
    result.payload.map((row) => row.id),
    ["closest-basic", "boosted-premium", "near-basic"],
  );
});

test("nearby Premium boost changes ordering only inside the one-mile boundary", async () => {
  globalThis.__rankingRouteState = {
    rows: [
      { placeId: "basic", premium: false, latitude: 1, longitude: 1, distanceMiles: 1 },
      { placeId: "premium-inside", premium: true, latitude: 1, longitude: 1, distanceMiles: 1.99 },
      { placeId: "premium-outside", premium: true, latitude: 1, longitude: 1, distanceMiles: 2.01 },
    ],
  };

  const result = await request(nearbyHandler, {
    latitude: "0",
    longitude: "0",
    radiusMiles: "5",
  });

  assert.deepEqual(
    result.payload.map((row) => row.id),
    ["premium-inside", "basic", "premium-outside"],
  );
});

test("nearby results use true distance after adjusted-distance ties", async () => {
  globalThis.__rankingRouteState = {
    rows: [
      { placeId: "premium", premium: true, latitude: 1, longitude: 1, distanceMiles: 1.3 },
      { placeId: "basic", premium: false, latitude: 1, longitude: 1, distanceMiles: 0.3 },
    ],
  };

  const result = await request(nearbyHandler, {
    latitude: "0",
    longitude: "0",
    radiusMiles: "5",
  });

  assert.deepEqual(result.payload.map((row) => row.id), ["basic", "premium"]);
});

test("nearby radius uses true distance and Basic-only ties are deterministic", async () => {
  globalThis.__rankingRouteState = {
    rows: [
      { placeId: "outside-premium", premium: true, latitude: 1, longitude: 1, distanceMiles: 5.5 },
      { placeId: "basic-b", premium: false, latitude: 1, longitude: 1, distanceMiles: 2 },
      { placeId: "basic-a", premium: false, latitude: 1, longitude: 1, distanceMiles: 2 },
    ],
  };

  const result = await request(nearbyHandler, {
    latitude: "0",
    longitude: "0",
    radiusMiles: "5",
  });

  assert.deepEqual(result.payload.map((row) => row.id), ["basic-a", "basic-b"]);
  assert.deepEqual(result.payload.map((row) => row.distanceMiles), [2, 2]);
});