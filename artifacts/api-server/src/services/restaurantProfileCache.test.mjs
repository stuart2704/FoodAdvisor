import assert from "node:assert/strict";
import test from "node:test";
import { profileCacheControl } from "./restaurantProfileCache.ts";

test("a profile fetched before UTC midnight cannot remain fresh on the next day", () => {
  const requestTime = new Date("2026-09-25T23:59:56.000Z");
  const responseTime = new Date("2026-09-25T23:59:57.000Z");
  const header = profileCacheControl(requestTime, responseTime);
  const maxAge = Number(header.match(/^public, max-age=(\d+)$/)?.[1]);
  assert.ok(Number.isInteger(maxAge) && maxAge > 0);
  const midnight = new Date("2026-09-26T00:00:00.000Z").getTime();
  assert.ok(responseTime.getTime() + maxAge * 1000 < midnight);
  assert.ok(responseTime.getTime() + maxAge * 1000 < new Date("2026-09-26T00:00:01.000Z").getTime());
});

test("profiles fetched well before midnight retain the normal five-minute limit", () => {
  assert.equal(profileCacheControl(
    new Date("2026-09-25T12:00:00.000Z"),
    new Date("2026-09-25T12:00:01.000Z"),
  ), "public, max-age=300");
});

test("a slow response crossing UTC midnight is not cacheable", () => {
  assert.equal(profileCacheControl(
    new Date("2026-09-25T23:59:59.000Z"),
    new Date("2026-09-26T00:00:01.000Z"),
  ), "no-store");
  assert.equal(profileCacheControl(
    new Date("2026-09-25T23:59:59.000Z"),
    new Date("2026-09-25T23:59:59.500Z"),
  ), "no-store");
});