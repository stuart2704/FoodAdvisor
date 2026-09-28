import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { candidateReviewStatus } from "./candidatePromotion.ts";
import { validateExternalCandidates } from "./candidateValidation.ts";

const candidate = {
  sourceName: "OSM",
  sourceId: "osm:node:123",
  rawName: "Sample Kitchen",
  rawAddress: "1 Main Street",
  rawCoords: { lat: 51.5, lon: -0.1 },
  rawPhone: null,
  rawWebsite: null,
  sourceFlags: ["open-data"],
  importedAt: "2026-01-01T00:00:00.000Z",
};

test("source identity and coordinates must be valid before storage", () => {
  assert.doesNotThrow(() => validateExternalCandidates([candidate]));
  for (const bad of [
    { sourceName: " OSM" },
    { sourceId: "" },
    { sourceId: "x".repeat(513) },
    { rawName: "  " },
    { rawCoords: { lat: 91, lon: 0 } },
    { rawCoords: { lat: Number.NaN, lon: 0 } },
    { sourceFlags: null },
  ]) {
    assert.throws(() => validateExternalCandidates([{ ...candidate, ...bad }]));
  }
});

test("candidate assessment remains unverified or review-ready, never published", () => {
  assert.equal(candidateReviewStatus({ ...candidate, rawCoords: null }), "unverified");
  assert.ok(["unverified", "review_ready"].includes(candidateReviewStatus(candidate)));
});

test("ingestion cannot write restaurants or run outreach and requires matching adapter source", async () => {
  const runner = await readFile(new URL("../cron/externalIngestion.ts", import.meta.url), "utf8");
  assert.match(runner, /candidate\.sourceName !== name/);
  assert.match(runner, /storeExternalCandidates\(dedupedCandidates, now\)/);
  assert.doesNotMatch(runner, /promoteCandidates|restaurantsTable|outreachPriority|outreachThrottle/);
  const store = await readFile(new URL("./candidateStore.ts", import.meta.url), "utf8");
  assert.match(store, /onConflictDoNothing/);
  assert.match(store, /eq\(externalCandidatesTable\.verificationStatus, "unverified"\)/);
});