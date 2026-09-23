import assert from "node:assert/strict";
import { test } from "node:test";
import { needsDeepCrawl } from "./gridDeepCrawl.ts";

const complete = {
  rating: 4.2, reviewCount: 100,
  cuisines: ["thai"], amenities: ["delivery"],
};

test("flags material rating and review changes, not exact thresholds", () => {
  assert.equal(needsDeepCrawl(complete, { rating: 3.6 }), true);
  assert.equal(needsDeepCrawl(complete, { rating: 4.7 }), false);
  assert.equal(needsDeepCrawl(complete, { reviewCount: 251 }), true);
  assert.equal(needsDeepCrawl(complete, { reviewCount: 250 }), false);
  assert.equal(needsDeepCrawl(complete, { reviewCount: 90 }), false);
  assert.equal(needsDeepCrawl(complete, { rating: Number.NaN }), false);
});

test("flags popular restaurants and missing cuisines or amenities", () => {
  assert.equal(needsDeepCrawl({ ...complete, reviewCount: 501 }, {}), true);
  assert.equal(needsDeepCrawl({ ...complete, reviewCount: 500 }, {}), false);
  assert.equal(needsDeepCrawl({ ...complete, cuisines: [] }, {}), true);
  assert.equal(needsDeepCrawl({ ...complete, amenities: null }, {}), true);
  assert.equal(needsDeepCrawl(complete, {}), false);
});