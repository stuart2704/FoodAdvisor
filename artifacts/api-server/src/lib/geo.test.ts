import assert from "node:assert/strict";
import test from "node:test";
import {
  haversineDistanceMiles,
  isValidLatitude,
  isValidLongitude,
  normaliseCoordinates,
} from "./geo.ts";

test("validates latitude and longitude bounds", () => {
  assert.equal(isValidLatitude(51.5072), true);
  assert.equal(isValidLatitude(-90), true);
  assert.equal(isValidLatitude(90.01), false);
  assert.equal(isValidLongitude(-0.1276), true);
  assert.equal(isValidLongitude(180.01), false);
});

test("normalises a valid Places location and rejects incomplete data", () => {
  assert.deepEqual(
    normaliseCoordinates({ latitude: "51.5072", longitude: "-0.1276" }),
    { latitude: 51.5072, longitude: -0.1276 },
  );
  assert.equal(normaliseCoordinates({ latitude: 51.5 }), null);
  assert.equal(normaliseCoordinates({ latitude: 95, longitude: 0 }), null);
});

test("calculates a stable distance in miles", () => {
  const london = { latitude: 51.5072, longitude: -0.1276 };
  const westminster = { latitude: 51.4975, longitude: -0.1357 };
  const distance = haversineDistanceMiles(london, westminster);
  assert.ok(distance > 0.6 && distance < 0.9);
  assert.equal(haversineDistanceMiles(london, london), 0);
});