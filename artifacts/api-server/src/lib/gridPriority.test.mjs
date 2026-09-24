import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUDGET_COMFORT, BUDGET_CRITICAL, BUDGET_TIGHT,
  classifyGridPriority, futurePaidWorkSkipReason, PRIORITY,
} from "./gridPriority.ts";

const now = new Date("2026-09-24T12:00:00.000Z");
const complete = {
  updatedAt: now,
  rating: 4.2,
  reviewCount: 100,
  address: "1 High Street",
  cuisines: ["thai"],
  amenities: ["delivery"],
  priceLevel: "MODERATE",
  website: "https://example.com",
};

test("ranks deep eligibility above fillable recovery and staleness", () => {
  assert.deepEqual(PRIORITY, { DEEP: 3, RECOVERY: 2, STALE: 1, FRESH: 0 });
  assert.equal(classifyGridPriority({ ...complete, reviewCount: 501, website: null }, {
    website: "https://example.com",
  }, now), PRIORITY.DEEP);
  assert.equal(classifyGridPriority({ ...complete, website: null }, {
    website: "https://example.com",
  }, now), PRIORITY.RECOVERY);
  assert.equal(classifyGridPriority({ ...complete, updatedAt: new Date("2026-07-01T00:00:00Z") }, {}, now), PRIORITY.STALE);
});

test("missing unfillable phone alone does not mark a fresh result as recovery", () => {
  assert.equal(classifyGridPriority(complete, {}, now), PRIORITY.FRESH);
  assert.equal(classifyGridPriority({ ...complete, website: null }, {}, now), PRIORITY.FRESH);
});

test("existing deep eligibility for missing amenities remains informational", () => {
  assert.equal(classifyGridPriority({ ...complete, amenities: null }, {}, now), PRIORITY.DEEP);
});

test("future paid-work policy tightens at 40%, 70%, and 90%, then stops all at 100%", () => {
  assert.deepEqual([BUDGET_COMFORT, BUDGET_TIGHT, BUDGET_CRITICAL], [24, 42, 54]);
  assert.equal(futurePaidWorkSkipReason(23, PRIORITY.FRESH), null);
  assert.equal(futurePaidWorkSkipReason(24, PRIORITY.FRESH), "skip_budget_comfort");
  assert.equal(futurePaidWorkSkipReason(42, PRIORITY.STALE), "skip_budget_tight");
  assert.equal(futurePaidWorkSkipReason(54, PRIORITY.RECOVERY), "skip_budget_critical");
  assert.equal(futurePaidWorkSkipReason(59, PRIORITY.DEEP), null);
  assert.equal(futurePaidWorkSkipReason(60, PRIORITY.DEEP), "paid_budget_exceeded");
  assert.throws(() => futurePaidWorkSkipReason(-1, PRIORITY.DEEP), /Invalid/);
});