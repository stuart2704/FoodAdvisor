import assert from "node:assert/strict";
import { test } from "node:test";
import { nextGridPosition, resolveGridPosition } from "./gridPosition.ts";

const grid = {
  north_america: { New_York_City: [[40.7128, -74.006]] },
  europe: { London: [[51.5074, -0.1278], [51.51, -0.13]] },
};

test("uses schedule order rather than JSON object order", () => {
  const london = resolveGridPosition(grid, { regionIndex: 0, cityIndex: 0, pointIndex: 1 });
  assert.equal(london.region, "europe");
  assert.equal(london.point.city, "London");
  assert.equal(london.flatIndex, 1);
  const newYork = resolveGridPosition(grid, { regionIndex: 1, cityIndex: 0, pointIndex: 0 });
  assert.equal(newYork.point.city, "New York");
  assert.equal(newYork.flatIndex, 2);
});

test("rejects absent regions and out-of-range saved indexes", () => {
  assert.throws(() => resolveGridPosition(grid, { regionIndex: 2, cityIndex: 0, pointIndex: 0 }), /No coordinate points/);
  assert.throws(() => resolveGridPosition(grid, { regionIndex: 0, cityIndex: 1, pointIndex: 0 }), /city index/);
  assert.throws(() => resolveGridPosition(grid, { regionIndex: 0, cityIndex: 0, pointIndex: 2 }), /point index/);
  assert.throws(() => resolveGridPosition(grid, { regionIndex: -1, cityIndex: 0, pointIndex: 0 }), /nonnegative/);
});

test("advances to the next unprocessed point and stops instead of wrapping", () => {
  assert.deepEqual(nextGridPosition(grid, { regionIndex: 0, cityIndex: 0, pointIndex: 0 }),
    { regionIndex: 0, cityIndex: 0, pointIndex: 1 });
  assert.deepEqual(nextGridPosition(grid, { regionIndex: 0, cityIndex: 0, pointIndex: 1 }),
    { regionIndex: 1, cityIndex: 0, pointIndex: 0 });
  assert.equal(nextGridPosition(grid, { regionIndex: 1, cityIndex: 0, pointIndex: 0 }), null);
});