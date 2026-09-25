import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const dbMock = `
const table = (kind) => new Proxy({ kind }, {
  get(target, key) { return key === "kind" ? kind : { name: key }; },
});
export const restaurantsTable = table("restaurants");
export const restaurantOffersTable = table("offers");
export const restaurantEventsTable = table("events");
export const restaurantMenuItemsTable = table("menu");
export const restaurantChefProfilesTable = table("chef");
export const restaurantCollectionMembersTable = table("members");
export const restaurantCollectionsTable = table("collections");

function matches(condition, row) {
  if (condition.op === "and") return condition.conditions.every((part) => matches(part, row));
  if (condition.op === "inArray") return false; // No collection fixtures in these tests.
  const actual = row[condition.column.name];
  if (condition.op === "eq") return actual === condition.value;
  if (condition.op === "lte") return actual <= condition.value;
  if (condition.op === "gte") return actual >= condition.value;
  throw new Error("Unsupported filter: " + condition.op);
}
export const db = {
  select(selection) {
    const query = {
      from(table) { this.table = table; return this; },
      innerJoin() { return this; },
      where(condition) { this.condition = condition; return this; },
      orderBy(...columns) { this.order = columns; return this; },
      limit(count) { this.count = count; return this; },
      then(resolve, reject) {
        try {
          const state = globalThis.__profileTestState;
          state.queries.push(this.table.kind);
          const rows = state[this.table.kind].filter((row) =>
            !this.condition || matches(this.condition, row));
          if (this.order) rows.sort((a, b) => {
            for (const column of this.order) {
              const result = a[column.name] < b[column.name] ? -1 : a[column.name] > b[column.name] ? 1 : 0;
              if (result) return result;
            }
            return 0;
          });
          resolve((this.count ? rows.slice(0, this.count) : rows).map((row) =>
            selection
              ? Object.fromEntries(Object.entries(selection).map(([key, column]) => [key, row[column.name]]))
              : { ...row }));
        } catch (error) { reject(error); }
      },
    };
    return query;
  },
};
`;

const conditionsMock = `
export const and = (...conditions) => ({ op: "and", conditions });
export const asc = (column) => column;
export const eq = (column, value) => ({ op: "eq", column, value });
export const gte = (column, value) => ({ op: "gte", column, value });
export const lte = (column, value) => ({ op: "lte", column, value });
export const inArray = (column, value) => ({ op: "inArray", column, value });
`;

const directory = await mkdtemp(path.join(os.tmpdir(), "profile-offers-"));
const output = path.join(directory, "profile.mjs");
try {
  await build({
    entryPoints: [path.resolve(import.meta.dirname, "restaurantProfileEngine.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "profile-db-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$/ }, (args) => ({
          path: args.path, namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: args.path === "drizzle-orm" ? conditionsMock : dbMock,
          loader: "js",
        }));
      },
    }],
  });
} catch (error) {
  await rm(directory, { recursive: true, force: true });
  throw error;
}
const { getRestaurantProfile } = await import(pathToFileURL(output).href);

const today = "2026-09-25";
const restaurant = {
  placeId: "verified-place",
  published: true,
  claimedAt: new Date("2026-01-01T12:00:00Z"),
  claimStatus: "verified",
  name: "Example Bistro",
  sourceName: "google",
  sourceAttribution: null,
  city: "London",
  region: null,
  country: "UK",
  cuisineTags: [],
  types: [],
  priceLevel: null,
  currency: "GBP",
  premium: false,
  qualificationScore: null,
  popularity: 0,
  aiRelevanceBoost: null,
  openingHours: [],
  rating: null,
  address: "Example Street",
};

function reset(restaurants = [restaurant], offers = [], events = []) {
  globalThis.__profileTestState = {
    restaurants, offers, events, menu: [], chef: [], members: [], collections: [],
    queries: [],
  };
}

async function profileAtFixedDay(id) {
  const OriginalDate = globalThis.Date;
  globalThis.Date = class extends OriginalDate {
    constructor(...args) {
      super(...(args.length ? args : ["2026-09-25T12:00:00.000Z"]));
    }
  };
  try {
    return await getRestaurantProfile(id);
  } finally {
    globalThis.Date = OriginalDate;
  }
}

function offer(id, title, startDate, endDate, restaurantId = restaurant.placeId) {
  return { id, title, description: title + " description", startDate, endDate, restaurantId };
}

function event(id, title, eventDate, eventTime, restaurantId = restaurant.placeId) {
  return {
    id, title, description: title + " description", eventDate, eventTime,
    price: "Free", restaurantId,
  };
}

test("profile exposes only active offers, including both same-day boundaries", async () => {
  reset([restaurant], [
    offer(1, "Starts today", today, "2026-09-26"),
    offer(2, "Ends today", "2026-09-24", today),
    offer(3, "Today only", today, today),
    offer(4, "Already active", "2026-09-24", "2026-09-26"),
    offer(5, "Starts tomorrow", "2026-09-26", "2026-09-27"),
    offer(6, "Ended yesterday", "2026-09-23", "2026-09-24"),
    offer(7, "Another listing", today, today, "other-place"),
  ]);

  const profile = await profileAtFixedDay(restaurant.placeId);
  assert.equal(profile.verified, true);
  assert.deepEqual(profile.offers.map((item) => item.title),
    ["Ends today", "Today only", "Already active", "Starts today"]);
  assert.deepEqual(profile.offers[1], {
    title: "Today only", description: "Today only description",
    startDate: today, endDate: today,
  });
});

test("unverified and unpublished listings cannot expose their stored offers", async () => {
  const states = [
    { claimStatus: null, claimedAt: null },
    { claimStatus: "pending", claimedAt: null },
    { claimStatus: "verified", claimedAt: null },
    { claimStatus: "pending", claimedAt: restaurant.claimedAt, published: false },
  ];
  for (const state of states) {
    reset([{ ...restaurant, ...state }], [offer(1, "Private offer", today, today)]);
    const profile = await profileAtFixedDay(restaurant.placeId);
    if (state.published === false) {
      assert.equal(profile, null);
    } else {
      assert.equal(profile.verified, false);
      assert.deepEqual(profile.offers, []);
    }
    assert.equal(globalThis.__profileTestState.queries.includes("offers"), false);
  }
});

test("active offers with matching expiry dates have a stable start-date and ID order", async () => {
  reset([restaurant], [
    offer(30, "Later start, high ID", "2026-09-24", "2026-09-30"),
    offer(22, "Earlier start", "2026-09-23", "2026-09-30"),
    offer(10, "Later start, low ID", "2026-09-24", "2026-09-30"),
    offer(40, "Sooner expiry", "2026-09-24", "2026-09-26"),
  ]);
  const profile = await profileAtFixedDay(restaurant.placeId);
  assert.deepEqual(profile.offers.map((item) => item.title), [
    "Sooner expiry", "Earlier start", "Later start, low ID", "Later start, high ID",
  ]);
});

test("verified public profile includes today's and future events in date/time order, not past or other listings", async () => {
  reset([restaurant], [], [
    event(1, "Future evening", "2026-09-26", "20:00"),
    event(2, "Today evening", today, "20:00"),
    event(3, "Yesterday", "2026-09-24", "23:59"),
    event(4, "Today morning", today, "09:00"),
    event(5, "Future morning", "2026-09-26", "09:00"),
    event(6, "Other listing", today, "08:00", "other-place"),
    event(7, "Today midnight", today, "00:00"),
  ]);

  const profile = await profileAtFixedDay(restaurant.placeId);
  assert.equal(profile.verified, true);
  assert.deepEqual(profile.events.map((item) => item.title), [
    "Today midnight", "Today morning", "Today evening",
    "Future morning", "Future evening",
  ]);
  assert.deepEqual(profile.events[1], {
    title: "Today morning", description: "Today morning description",
    date: today, time: "09:00", price: "Free",
  });
});

test("unverified and unpublished listings never expose stored future events", async () => {
  const states = [
    { claimStatus: null, claimedAt: null },
    { claimStatus: "pending", claimedAt: null },
    { claimStatus: "verified", claimedAt: null },
    { claimStatus: "pending", claimedAt: restaurant.claimedAt, published: false },
  ];
  for (const state of states) {
    reset([{ ...restaurant, ...state }], [], [
      event(1, "Stored event", "2026-09-26", "19:00"),
    ]);
    const profile = await profileAtFixedDay(restaurant.placeId);
    if (state.published === false) {
      assert.equal(profile, null);
    } else {
      assert.equal(profile.verified, false);
      assert.deepEqual(profile.events, []);
    }
    assert.equal(globalThis.__profileTestState.queries.includes("events"), false);
  }
});

test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});