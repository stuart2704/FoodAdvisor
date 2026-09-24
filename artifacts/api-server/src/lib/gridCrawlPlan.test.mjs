import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMERGENCY_RESERVE, HIGH_PRIORITY_REGION_INTERVAL_DAYS, LOW_PRIORITY_REGION_INTERVAL_DAYS,
  MONTHLY_PAID_BUDGET_GBP, MONTHLY_PAID_LIMIT,
  adaptiveBudgetForCity, budgetPerPoint, cityBudgetReached, computeCityBudgets,
  computeCityWeight, computeRegionBudgets,
  computeRegionInterval, computeRegionPriority,
  computeRegionWeight, computeWeight, regionBudgetReached,
  paidGridBudgetReached, paidPlacesBudgetReached, gridHash, parseGrid, validateProgress,
} from "./gridCrawlPlan.ts";

const grid = {
  europe: { London: [[51.5074, -0.1278]] },
  north_america: { New_York_City: [[40.7128, -74.006]] },
};

test("the proposed emergency reserve is five of the 50 daily attempts", () => {
  assert.equal(EMERGENCY_RESERVE, 5);
});

test("stops before exceeding the £30 estimated monthly ceiling or 60 reserved calls", () => {
  assert.equal(MONTHLY_PAID_BUDGET_GBP, 30);
  assert.equal(MONTHLY_PAID_LIMIT, 60);
  assert.equal(paidGridBudgetReached(2950, 59, 3000), false);
  assert.equal(paidGridBudgetReached(3000, 59, 3000), true);
  assert.equal(paidGridBudgetReached(0, 60, 3000), true);
  assert.equal(paidGridBudgetReached(2450, 49, 2500), false);
  assert.equal(paidGridBudgetReached(2500, 50, 2500), true);
  assert.throws(() => paidGridBudgetReached(NaN, 0, 3000), /Invalid monthly/);
  assert.throws(() => paidGridBudgetReached(0, -1, 3000), /Invalid monthly/);
  assert.throws(() => paidGridBudgetReached(0, 0, 3001), /Invalid monthly/);
});

test("shared Places cap counts older underpriced requests and higher-cost calls", () => {
  assert.equal(paidPlacesBudgetReached(295, 59, 50, 3000), false);
  assert.equal(paidPlacesBudgetReached(300, 60, 50, 3000), true);
  assert.equal(paidPlacesBudgetReached(2900, 58, 100, 3000), false);
  assert.equal(paidPlacesBudgetReached(2950, 59, 100, 3000), true);
  assert.equal(paidPlacesBudgetReached(950, 19, 50, 1000), false);
  assert.equal(paidPlacesBudgetReached(1000, 20, 50, 1000), true);
  assert.throws(() => paidPlacesBudgetReached(0, 0, 5, 3000), /Invalid monthly/);
});
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

test("accepts scored city objects and computes the requested 40/30/30 weight", () => {
  const cardiff = { points: [[51.4816, -3.1791], [51.485, -3.17]],
    popularity: 0.8, density: 0.6, missing_fields_rate: 0.3 };
  const points = parseGrid({ europe: { cardiff } });
  assert.equal(points.length, 2);
  assert.deepEqual(points.map((point) => point.city), ["Cardiff", "Cardiff"]);
  assert.deepEqual(points[0].cityMetadata, {
    popularity: 0.8, density: 0.6, missing_fields_rate: 0.3,
  });
  assert.ok(Math.abs(computeWeight(cardiff) - 0.59) < 1e-12);
  assert.ok(Math.abs(points[1].cityWeight - 0.59) < 1e-12);
  assert.equal(budgetPerPoint(20), 3);
  assert.equal(adaptiveBudgetForCity(20, cardiff), 3);
  assert.throws(() => budgetPerPoint(0), /positive number/);
});

test("rejects malformed scored cities instead of silently dropping scores", () => {
  const city = { points: [[51.4816, -3.1791]], popularity: 0.8,
    density: 0.6, missing_fields_rate: 0.3 };
  assert.throws(() => parseGrid({ europe: { cardiff: { ...city, density: 1.2 } } }), /number from 0 to 1/);
  assert.throws(() => parseGrid({ europe: { cardiff: { ...city, popularity: undefined } } }), /number from 0 to 1/);
  assert.throws(() => parseGrid({ europe: { cardiff: { ...city, typo: 1 } } }), /supported planning scores/);
  assert.throws(() => parseGrid({ europe: { cardiff: { ...city, points: [[91, -3]] } } }), /Invalid/);
});

test("scores a city budget with the four-factor formula independently of grid point weight", () => {
  const cardiff = {
    popularity: 0.8, density: 0.6, missing_fields_rate: 0.3, stale_rate: 0.2,
  };
  assert.ok(Math.abs(computeCityWeight(cardiff) - 0.58) < 1e-12);
  assert.ok(Math.abs(computeWeight(cardiff) - 0.59) < 1e-12);
  assert.deepEqual(computeCityBudgets(["cardiff"], { cardiff }, 30), { cardiff: 30 });
  assert.equal(cityBudgetReached(1, 2), false);
  assert.equal(cityBudgetReached(2, 2), true);
  assert.throws(() => cityBudgetReached(0, 0), /unconfigured/);
  assert.throws(() => cityBudgetReached(0, MONTHLY_PAID_LIMIT + 1), /invalid/);
  assert.throws(() => computeCityBudgets(["cardiff", "london"], { cardiff }, 30), /metadata for every city/);
  assert.throws(() => computeCityBudgets(["cardiff"], { cardiff }, 0), /unconfigured/);
  assert.throws(() => computeCityWeight({ ...cardiff, stale_rate: 2 }), /number from 0 to 1/);
});

test("scores normalized regions at the proposed 40/30/20/10 weights", () => {
  const europe = {
    popularity: 0.9, density: 0.8, missing_fields_rate: 0.4, stale_rate: 0.3,
  };
  const asia = {
    popularity: 0.7, density: 0.9, missing_fields_rate: 0.5, stale_rate: 0.2,
  };
  assert.ok(Math.abs(computeRegionPriority(europe) - 0.71) < 1e-12);
  assert.equal(computeRegionWeight(europe), computeRegionPriority(europe));
  assert.ok(Math.abs(computeRegionPriority(asia) - 0.67) < 1e-12);
  assert.throws(() => computeRegionPriority({ ...europe, stale_rate: -0.1 }), /number from 0 to 1/);
  assert.equal(LOW_PRIORITY_REGION_INTERVAL_DAYS, 7);
  assert.equal(HIGH_PRIORITY_REGION_INTERVAL_DAYS, 1);
  assert.equal(computeRegionInterval(0), 7);
  assert.equal(computeRegionInterval(1), 1);
  assert.equal(computeRegionInterval(computeRegionPriority(europe)), 3);
  assert.equal(computeRegionInterval(computeRegionPriority(asia)), 3);
  assert.deepEqual(computeRegionBudgets({ europe, asia }), { europe: 30, asia: 29 });
  assert.equal(computeRegionBudgets({ europe }).europe, MONTHLY_PAID_LIMIT);
  assert.equal(regionBudgetReached(29, 30), false);
  assert.equal(regionBudgetReached(30, 30), true);
  assert.throws(() => regionBudgetReached(0, 0), /unconfigured/);
  assert.throws(() => regionBudgetReached(0, MONTHLY_PAID_LIMIT + 1), /invalid/);
  assert.throws(() => computeRegionBudgets({}), /At least one region/);
  assert.throws(() => computeRegionBudgets({
    europe: { popularity: 0, density: 0, missing_fields_rate: 0, stale_rate: 0 },
  }), /positive total/);
  assert.throws(() => computeRegionInterval(Number.NaN), /number from 0 to 1/);
  assert.throws(() => computeRegionInterval(1.1), /number from 0 to 1/);
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