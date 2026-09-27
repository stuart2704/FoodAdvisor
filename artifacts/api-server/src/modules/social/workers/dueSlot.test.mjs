import assert from "node:assert/strict";
import { test } from "node:test";
import { assignedToday, dueSlotToday, missedUtcDay } from "./dueSlot.ts";

test("a delayed external job catches up on today's UTC slot", () => {
  const now = new Date("2026-09-27T12:05:00Z");
  assert.equal(dueSlotToday("12:00", now)?.toISOString(), "2026-09-27T12:00:00.000Z");
  assert.equal(dueSlotToday("12:06", now), null);
  assert.equal(dueSlotToday("23:59", new Date("2026-09-28T00:01:00Z")), null);
});

test("each schedule can assign only once per UTC day", () => {
  const now = new Date("2026-09-28T00:01:00Z");
  assert.equal(assignedToday(new Date("2026-09-27T23:59:00Z"), now), false);
  assert.equal(assignedToday(new Date("2026-09-28T00:00:00Z"), now), true);
  assert.equal(assignedToday(null, now), false);
});

test("a full-day outage leaves yesterday's queued posts for review on restart", () => {
  const scheduledFor = new Date("2026-09-27T23:55:00Z");
  const resumed = new Date("2026-09-28T00:05:00Z");
  assert.equal(missedUtcDay(scheduledFor, resumed), true);
  assert.equal(dueSlotToday("23:55", resumed), null);
  assert.equal(missedUtcDay(new Date("2026-09-28T00:00:00Z"), resumed), false);
  assert.equal(missedUtcDay(new Date("2026-09-28T00:04:00Z"), resumed), false);
});