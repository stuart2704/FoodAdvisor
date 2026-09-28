import assert from "node:assert/strict";
import test from "node:test";
import { checkGooglePhotoAccess, isOsmPlaceId } from "./photo-provider.ts";

test("OSM identifiers are recognized case-insensitively", () => {
  assert.equal(isOsmPlaceId("osm:node/123"), true);
  assert.equal(isOsmPlaceId("OSM:way/456"), true);
  assert.equal(isOsmPlaceId("ChIJgoogle-place"), false);
});

test("unpublished OSM IDs cannot reach Google Places photo lookup", () => {
  assert.deepEqual(checkGooglePhotoAccess("osm:node/123", null), {
    allowed: false,
    status: 404,
    body: { error: "Restaurant not found." },
  });
  assert.equal(checkGooglePhotoAccess("osm:node/123", {
    sourceName: "OSM",
    sourceAttribution: "© OpenStreetMap contributors",
    published: false,
  }).allowed, false);
});

test("published OSM profiles do not call Google but allow owner uploads", () => {
  assert.deepEqual(checkGooglePhotoAccess("osm:node/123", {
    sourceName: "OSM",
    sourceAttribution: "© OpenStreetMap contributors, ODbL",
    published: true,
  }), {
    allowed: false,
    status: 409,
    body: {
      error: "Google Places photos are not available for this source.",
      sourceName: "OSM",
      sourceAttribution: "© OpenStreetMap contributors, ODbL",
      uploadSupported: true,
    },
  });
});

test("photo access preserves published Google rows and hides unpublished rows", () => {
  assert.deepEqual(checkGooglePhotoAccess("ChIJgoogle-place", {
    sourceName: "google",
    sourceAttribution: null,
    published: true,
  }), { allowed: true });
  assert.equal(checkGooglePhotoAccess("ChIJhidden-place", {
    sourceName: "google",
    sourceAttribution: null,
    published: false,
  }).allowed, false);
});