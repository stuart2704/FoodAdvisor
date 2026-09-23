import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMissingFields, missingFieldNames, isStale, stalenessReasons, STALE_AFTER_MS } from "./gridStaleness.ts";

const now = new Date("2026-09-23T12:00:00Z");
const recent = {
  updatedAt: new Date(now.getTime() - STALE_AFTER_MS + 1),
  rating: 4.2,
  reviewCount: 100,
  address: "1 Main Street",
  cuisines: ["thai"],
  priceLevel: "PRICE_LEVEL_MODERATE",
  website: "https://restaurant.example",
};

test("refreshes missing or older-than-60-day rows", () => {
  assert.equal(isStale({ ...recent, updatedAt: null }, {}, now), true);
  assert.equal(isStale({ ...recent, updatedAt: new Date(now.getTime() - STALE_AFTER_MS - 1) }, {}, now), true);
  assert.equal(isStale(recent, {}, now), false);
  assert.equal(isStale({ ...recent, updatedAt: new Date(now.getTime() - STALE_AFTER_MS) }, {}, now), false);
});

test("refreshes on material changes but not exact thresholds", () => {
  assert.equal(isStale(recent, { rating: 3.8 }, now), true);
  assert.equal(isStale(recent, { reviewCount: 151 }, now), true);
  assert.equal(isStale(recent, { reviewCount: 150 }, now), false);
  assert.equal(isStale(recent, { reviewCount: 90 }, now), false);
  assert.equal(isStale(recent, { rating: 4.2 }, now), false);
  assert.equal(isStale(recent, { rating: 4.5 }, now), false);
  assert.deepEqual(stalenessReasons(recent, { rating: 3.8, reviewCount: 151 }, now), ["rating", "reviews"]);
});

test("fills missing fields only when incoming verified values can supply them", () => {
  assert.equal(isStale({ ...recent, address: "" }, { address: "2 Main Street" }, now), true);
  assert.equal(isStale({ ...recent, cuisines: null }, { cuisines: ["thai"] }, now), true);
  assert.equal(isStale({ ...recent, priceLevel: null }, { priceLevel: "PRICE_LEVEL_EXPENSIVE" }, now), true);
  assert.equal(isStale({ ...recent, website: null }, { website: "https://restaurant.example" }, now), true);
  assert.equal(isStale({ ...recent, cuisines: null }, { cuisines: [] }, now), false);
  assert.equal(isStale({ ...recent, priceLevel: null }, {}, now), false);
  assert.deepEqual(stalenessReasons(
    { ...recent, address: "", cuisines: null, priceLevel: null },
    { address: "2 Main Street", cuisines: ["thai"], priceLevel: "PRICE_LEVEL_MODERATE" },
    now,
  ), ["missing_address", "missing_cuisines", "missing_price"]);
});

test("reports profile gaps without using unfillable amenities or public phone for refresh", () => {
  const incomplete = {
    address: "1 Main Street", price_level: "PRICE_LEVEL_MODERATE",
    cuisines: ["thai"], amenities: [], phone: null, website: "https://restaurant.example",
  };
  assert.equal(hasMissingFields(incomplete), true);
  assert.deepEqual(missingFieldNames(incomplete), ["amenities", "phone"]);
  assert.equal(isStale(recent, {}, now), false);
  assert.equal(hasMissingFields({
    address: "1 Main Street", price_level: "PRICE_LEVEL_MODERATE",
    cuisines: ["thai"], amenities: ["delivery"], phone: "01234", website: "https://restaurant.example",
  }), false);
});