import assert from "node:assert/strict";
import test from "node:test";
import { getHeartbeatStatus } from "./engineHeartbeat";

const NOW = Date.UTC(2026, 8, 23, 12);

test("interactive services expire after 45 seconds", () => {
  assert.equal(
    getHeartbeatStatus("api", new Date(NOW - 44_999), NOW),
    "online",
  );
  assert.equal(
    getHeartbeatStatus("database", new Date(NOW - 45_000), NOW),
    "offline",
  );
});

test("the metrics queue remains online between 30-minute runs", () => {
  assert.equal(
    getHeartbeatStatus("queue", new Date(NOW - 44 * 60_000), NOW),
    "online",
  );
  assert.equal(
    getHeartbeatStatus("queue", new Date(NOW - 45 * 60_000), NOW),
    "offline",
  );
});

test("outreach engines remain online between three-hour runs", () => {
  assert.equal(
    getHeartbeatStatus("ai", new Date(NOW - 3.5 * 60 * 60_000), NOW),
    "online",
  );
  assert.equal(
    getHeartbeatStatus("automation", new Date(NOW - 4 * 60 * 60_000), NOW),
    "offline",
  );
});

test("future timestamps are not treated as healthy", () => {
  assert.equal(
    getHeartbeatStatus("queue", new Date(NOW + 1), NOW),
    "offline",
  );
});