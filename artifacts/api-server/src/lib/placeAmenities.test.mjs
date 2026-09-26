import assert from "node:assert/strict";
import { test } from "node:test";
import { AMENITY_DETAILS_MASK, fetchPlaceAmenities, verifiedAmenities } from "./placeAmenities.ts";
import { validateAmenityRunOptions } from "./placeAmenityReservations.ts";

test("Place Details mask requests only structured venue fields", () => {
  assert.equal(AMENITY_DETAILS_MASK,
    "id,delivery,takeout,outdoorSeating,accessibilityOptions,servesVegetarianFood");
});

test("absent fields are unknown, not guessed from free text", () => {
  assert.equal(verifiedAmenities({ id: "abc", displayName: { text: "Vegan Delivery" } }, "abc"), null);
  assert.deepEqual(verifiedAmenities({ id: "abc", delivery: false }, "abc"), []);
  assert.deepEqual(verifiedAmenities({ id: "abc", delivery: true, takeout: true,
    outdoorSeating: true, servesVegetarianFood: true,
    accessibilityOptions: { wheelchairAccessibleEntrance: true } }, "abc"),
  ["delivery", "takeaway", "outdoor_seating", "vegetarian", "wheelchair"]);
  assert.equal(verifiedAmenities({ id: "abc", accessibilityOptions: {} }, "abc"), null);
});

test("reject mismatched venues and malformed provider responses", () => {
  assert.throws(() => verifiedAmenities({ id: "other", delivery: true }, "abc"), /ID does not match/);
  assert.throws(() => verifiedAmenities({ id: "abc", delivery: "true" }, "abc"), /Invalid/);
});

test("provider errors and wrong venue responses fail without retries", async () => {
  let calls = 0;
  const forbidden = async (_url, init) => {
    calls++;
    assert.equal(init.headers["X-Goog-FieldMask"], AMENITY_DETAILS_MASK);
    return { ok: false, status: 429 };
  };
  await assert.rejects(fetchPlaceAmenities("abc", "test", forbidden), /429/);
  assert.equal(calls, 1);
  await assert.rejects(fetchPlaceAmenities("abc", "test", async () =>
    ({ ok: true, json: async () => ({ id: "other", delivery: true }) })), /ID does not match/);
});

test("no run is allowed without a valid explicit budget, request estimate and quota", () => {
  const options = { monthlyBudgetCents: 3000, estimatedRequestCents: 80, dailyLimit: 10, providerMinuteQuota: 1, maxRequests: 5 };
  assert.doesNotThrow(() => validateAmenityRunOptions(options));
  for (const invalid of [
    { estimatedRequestCents: 0 }, { estimatedRequestCents: 3001 },
    { dailyLimit: 0 }, { providerMinuteQuota: 0 }, { maxRequests: 11 }, { monthlyBudgetCents: 3001 },
  ]) assert.throws(() => validateAmenityRunOptions({ ...options, ...invalid }));
});