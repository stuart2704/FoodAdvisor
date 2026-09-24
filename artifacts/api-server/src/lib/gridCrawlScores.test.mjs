import assert from "node:assert/strict";
import test from "node:test";

const { computeGridCrawlScores } = await import("./gridCrawlScores.ts");
const { computeCityWeight } = await import("./gridCrawlPlan.ts");

const point = (city, region = "Europe") => ({
  city, region: "England", country: "United Kingdom", globalRegion: region,
  latitude: 51, longitude: -3,
});

test("computes Cardiff's independent score and the city-budget formula", () => {
  const scores = computeGridCrawlScores([point("Cardiff")], [{
    city: " cardiff ", global_region: "europe", restaurant_count: 2,
    popularity: 0.8, missing_fields_rate: 0.25, stale_rate: 0.5,
  }]);
  const cardiff = scores.cities["europe/Cardiff"];
  assert.deepEqual(cardiff, {
    popularity: 0.8, density: 1, missing_fields_rate: 0.25, stale_rate: 0.5,
  });
  assert.ok(Math.abs(computeCityWeight(cardiff) - 0.72) < 1e-12);
});

test("keeps a cold-start city explicit", () => {
  const scores = computeGridCrawlScores([point("Cardiff")], []);
  assert.deepEqual(scores.cities["europe/Cardiff"], {
    popularity: 0, density: 0, missing_fields_rate: 1, stale_rate: 1,
  });
  assert.deepEqual(scores.regions.europe, scores.cities["europe/Cardiff"]);
});

test("uses global region identity and refuses ambiguous legacy rows", () => {
  const points = [point("Springfield", "North America"), {
    ...point("Springfield", "Europe"), region: "England", country: "United Kingdom",
  }];
  const scores = computeGridCrawlScores(points, [{
    city: "SPRINGFIELD", global_region: "North America", restaurant_count: 1,
    popularity: 1, missing_fields_rate: 0, stale_rate: 0,
  }, {
    city: "Springfield", global_region: null, restaurant_count: 99,
    popularity: 1, missing_fields_rate: 0, stale_rate: 0,
  }]);
  assert.deepEqual(Object.keys(scores.regions).sort(), ["europe", "north_america"]);
  assert.equal(scores.cities["north_america/Springfield"].popularity, 1);
  assert.equal(scores.cities["europe/Springfield"].popularity, 0);
});