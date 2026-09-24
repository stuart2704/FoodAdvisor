import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRunScheduledGridCrawl } from "./gridCrawlSchedule.ts";

const enabled = {
  automation_enabled: true,
  pending_index: null,
  last_run_date: "2026-09-23",
};

test("a missed 04:00 UTC check runs once when the VM starts later", () => {
  assert.equal(shouldRunScheduledGridCrawl(enabled, new Date("2026-09-24T03:59:59Z")), false);
  assert.equal(shouldRunScheduledGridCrawl(enabled, new Date("2026-09-24T04:00:00Z")), true);
  assert.equal(shouldRunScheduledGridCrawl(enabled, new Date("2026-09-24T16:30:00Z")), true);
  assert.equal(shouldRunScheduledGridCrawl(
    { ...enabled, last_run_date: "2026-09-24" }, new Date("2026-09-24T16:30:00Z"),
  ), false);
});

test("a disabled crawler or uncertain point never starts an automatic paid run", () => {
  const now = new Date("2026-09-24T05:00:00Z");
  assert.equal(shouldRunScheduledGridCrawl({ ...enabled, automation_enabled: false }, now), false);
  assert.equal(shouldRunScheduledGridCrawl({ ...enabled, pending_index: 2 }, now), false);
});