import assert from "node:assert/strict";
import test from "node:test";
import { isReadyForCandidateReview } from "./candidateReviewEligibility.ts";

const complete = {
  sourceId: "osm:node:1",
  sourceName: "OSM",
  rawName: "London Cafe",
  rawAddress: "10 High Street",
  rawCoords: { lat: 51.5, lon: -0.1 },
  rawPhone: "+442079460958",
  rawWebsite: "https://example.com",
  sourceFlags: ["osm"],
  importedAt: "2026-09-25T00:00:00Z",
};

test("high-completeness candidates are ready for review, not automatically published", () => {
  assert.equal(isReadyForCandidateReview(complete), true);
});

test("score below 85 or a missing required field cannot qualify", () => {
  assert.equal(isReadyForCandidateReview({ ...complete, rawWebsite: null }), false);
  assert.equal(isReadyForCandidateReview({ ...complete, rawAddress: null }), false);
  assert.equal(isReadyForCandidateReview({ ...complete, rawCoords: null }), false);
});