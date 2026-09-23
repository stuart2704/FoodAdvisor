import assert from "node:assert/strict";
import { test } from "node:test";
import { verifiedExistingFields } from "./gridPlaceFields.ts";

test("refreshes only present Places fields and structured cuisine", () => {
  assert.deepEqual(verifiedExistingFields({
    displayName: { text: " New Name " },
    formattedAddress: " ",
    rating: 0,
    userRatingCount: 0,
    priceLevel: "",
    location: { latitude: 52, longitude: -1 },
    websiteUri: "https://restaurant.example/",
    googleMapsUri: "https://maps.example/new",
    types: ["restaurant", "thai_restaurant"],
  }), {
    name: "New Name",
    rating: 0,
    reviewCount: 0,
    website: "https://restaurant.example/",
    cuisineTags: ["thai"],
    cuisines: ["thai"],
  });
});

test("does not clear good fields or promote unverified page text", () => {
  assert.deepEqual(verifiedExistingFields({
    displayName: { text: " " },
    rating: Number.NaN,
    userRatingCount: -1,
    priceLevel: "PRICE_LEVEL_UNSPECIFIED",
    websiteUri: "javascript:alert(1)",
    types: ["restaurant"],
  }), {});
});