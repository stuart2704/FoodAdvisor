import assert from "node:assert/strict";
import { test } from "node:test";
import { gridHash, parseGrid, validateProgress } from "./gridCrawlPlan.ts";

const grid = {
  europe: { London: [[51.5074, -0.1278]] },
  north_america: { New_York_City: [[40.7128, -74.006]] },
};

test("accepts validated region/city coordinates, including New_York_City", () => {
  const points = parseGrid(grid);
  assert.equal(points.length, 2);
  assert.deepEqual(points.map(({ city, country }) => [city, country]), [
    ["London", "UK"],
    ["New York", "USA"],
  ]);
});

test("orders supplied regions by the schedule without inventing empty-region points", () => {
  const reversed = {
    south_america: {},
    north_america: { New_York_City: [[40.7128, -74.006]] },
    asia: {},
    europe: { London: [[51.5074, -0.1278]] },
  };
  assert.deepEqual(parseGrid(reversed).map((point) => point.city), ["London", "New York"]);
});

test("rejects missing, invalid, or mismatched grid data", () => {
  assert.throws(() => parseGrid({ unknown_region: {} }), /Unsupported grid region/);
  assert.throws(() => parseGrid({ europe: { Atlantis: [[51, 0]] } }), /Unknown city/);
  assert.throws(() => parseGrid({ europe: { London: [[91, 0]] } }), /Invalid/);
  assert.throws(() => parseGrid({ north_america: { London: [[51, 0]] } }), /does not belong/);
  assert.throws(() => parseGrid({ europe: { London: [] } }), /no coordinate points/);
});

test("progress requires matching grid hash and a bounded daily count", () => {
  const hash = gridHash(JSON.stringify(grid));
  const state = { version: 1, gridHash: hash, nextIndex: 1, date: "2026-09-23", attemptedToday: 4 };
  assert.deepEqual(validateProgress(state, hash, 2), state);
  assert.throws(() => validateProgress(state, gridHash("{}"), 2), /does not match/);
  assert.throws(() => validateProgress({ ...state, attemptedToday: 51 }, hash, 2), /invalid/);
  assert.throws(() => validateProgress({ ...state, nextIndex: 3 }, hash, 2), /invalid/);
});