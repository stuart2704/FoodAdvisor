import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, cuisineFromRestaurantName } from "./restaurantKeywords.ts";

test("finds whole cuisine phrases in the restaurant's own name", () => {
  assert.deepEqual(cuisineFromRestaurantName("The Italian Trattoria"), ["italian"]);
  assert.deepEqual(cuisineFromRestaurantName("Kimchi & Korean BBQ"), ["american", "korean"]);
});

test("does not match cuisine fragments in unrelated names", () => {
  assert.deepEqual(cuisineFromRestaurantName("The Thailander"), []);
  assert.deepEqual(cuisineFromRestaurantName("Bistro 21"), ["french"]);
});

test("classifies known venue text without substring false positives", () => {
  assert.deepEqual(classify("Italian food; vegan and gluten-free options"), {
    cuisines: ["italian"],
    amenities: ["vegan", "gluten_free"],
  });
  assert.deepEqual(classify("A deliveryman visited Thailander"), {
    cuisines: [],
    amenities: [],
  });
});