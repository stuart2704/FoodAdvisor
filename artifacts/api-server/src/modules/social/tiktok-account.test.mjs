import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewedTikTokAccount, pendingTikTokAccount } from "./tiktok-account.ts";

test("privacy approval refuses multiple creators even when they share an available privacy choice", () => {
  const first = { id: "first", privacyOptions: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"] };
  const second = { id: "second", privacyOptions: ["SELF_ONLY"] };
  assert.equal(reviewedTikTokAccount([first, second]), null);
  assert.equal(reviewedTikTokAccount([first, second], first.id), null);
  assert.equal(reviewedTikTokAccount([second], first.id), null);
  assert.equal(reviewedTikTokAccount([first], first.id), first);
});

test("pending status is bound to its submitting creator, never the newest account", () => {
  const first = { id: "first", publishId: "pending-first" };
  const second = { id: "second", publishId: "pending-second" };
  assert.equal(pendingTikTokAccount([second, first], first.id), first);
  assert.equal(pendingTikTokAccount([second], first.id), null);
  assert.equal(pendingTikTokAccount([second, first], null), null);
});