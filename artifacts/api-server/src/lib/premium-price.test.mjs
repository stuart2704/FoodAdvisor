import assert from "node:assert/strict";
import test from "node:test";
import {
  getPremiumPriceId,
  stripeKeyLivemode,
} from "./premium-price.ts";

test("a live Stripe key selects the owner's live £99 monthly price", () => {
  assert.equal(stripeKeyLivemode("sk_live_example"), true);
  assert.equal(stripeKeyLivemode("rk_live_example"), true);
  assert.equal(getPremiumPriceId(true), "price_1UE8sKGeEn25QPrrBWsjoZSy");
});

test("a test Stripe key selects only the sandbox price", () => {
  const previous = process.env.STRIPE_PREMIUM_PRICE_ID;
  try {
    process.env.STRIPE_PREMIUM_PRICE_ID = "price_sandbox";
    assert.equal(stripeKeyLivemode("sk_test_example"), false);
    assert.equal(getPremiumPriceId(false), "price_sandbox");
  } finally {
    if (previous === undefined) delete process.env.STRIPE_PREMIUM_PRICE_ID;
    else process.env.STRIPE_PREMIUM_PRICE_ID = previous;
  }
});

test("unknown key modes and missing sandbox configuration fail closed", () => {
  assert.throws(() => stripeKeyLivemode("unknown"), /mode could not be determined/);
  const previous = process.env.STRIPE_PREMIUM_PRICE_ID;
  try {
    delete process.env.STRIPE_PREMIUM_PRICE_ID;
    assert.throws(() => getPremiumPriceId(false), /not configured/);
  } finally {
    if (previous !== undefined) process.env.STRIPE_PREMIUM_PRICE_ID = previous;
  }
});