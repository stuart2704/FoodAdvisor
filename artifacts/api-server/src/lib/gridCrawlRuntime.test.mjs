import assert from "node:assert/strict";
import { test } from "node:test";
import {
  exhaustedAllocationTransition, isTerminalRegionPoint,
} from "./gridCrawlRuntime.ts";

const points = [
  { globalRegion: "Europe" }, { globalRegion: "Europe" },
  { globalRegion: "North America" }, { globalRegion: "North America" },
];

test("an exhausted first region advances to the next region, not the next day at the same point", () => {
  assert.deepEqual(exhaustedAllocationTransition("region", 2, 2, 4), {
    nextIndex: 2, resumeAt: 2, closeRegion: true,
  });
  assert.deepEqual(exhaustedAllocationTransition("city", 1, 2, 4), {
    nextIndex: 1, resumeAt: 1, closeRegion: false,
  });
  assert.deepEqual(exhaustedAllocationTransition("city", 2, 2, 4), {
    nextIndex: 2, resumeAt: 2, closeRegion: true,
  });
  assert.deepEqual(exhaustedAllocationTransition("region", 4, 4, 4), {
    nextIndex: 0, resumeAt: 4, closeRegion: true,
  });
});

test("a skipped terminal point closes its region pass but a middle point does not", () => {
  assert.equal(isTerminalRegionPoint(points, 0), false);
  assert.equal(isTerminalRegionPoint(points, 1), true);
  assert.equal(isTerminalRegionPoint(points, 2), false);
  assert.equal(isTerminalRegionPoint(points, 3), true);
  assert.throws(() => isTerminalRegionPoint(points, 4), /Invalid/);
});