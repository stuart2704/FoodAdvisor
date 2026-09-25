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

test("published OSM profiles return attribution and explicitly disable uploads", () => {
  assert.deepEqual(checkGooglePhotoAccess("osm:node/123", {
    sourceName: "OSM",
    sourceAttribution: "© OpenStreetMap contributors, ODbL",
    published: true,
  }), {
    allowed: false,
    status: 409,
    body: {
      error: "Google Places photos are not available for this source. OSM photo uploads are not supported yet.",
      sourceName: "OSM",
      sourceAttribution: "© OpenStreetMap contributors, ODbL",
      uploadSupported: false,
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