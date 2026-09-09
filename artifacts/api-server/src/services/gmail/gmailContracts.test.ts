import assert from "node:assert/strict";
import test from "node:test";
import {
  gmailPushStatus,
  gmailNotificationStatus,
  gmailThreadsPagePath,
  historyDeliveryStatus,
  isPermanentGmailMessageStatus,
  completedRecoveryState,
  threadDiscoveryComplete,
  GmailHttpError,
  summaryFetchFailureTransition,
} from "./gmailContracts.ts";

test("recovery uses official threads.list pagination parameters", () => {
  const first = gmailThreadsPagePath("in:inbox newer_than:30d -from:me");
  const next = gmailThreadsPagePath("in:inbox newer_than:30d -from:me", "next-page");
  assert.match(first, /^\/gmail\/v1\/users\/me\/threads\?/);
  assert.match(first, /maxResults=50/);
  assert.match(first, /q=in%3Ainbox/);
  assert.match(next, /pageToken=next-page/);
});

test("history staging retries when pages or a 20-message drain remain", () => {
  assert.equal(historyDeliveryStatus({ complete: false, failed: false, capped: false }), 503);
  assert.equal(historyDeliveryStatus({ complete: true, failed: false, capped: true }), 503);
  assert.equal(historyDeliveryStatus({ complete: true, failed: false, capped: false }), 204);
});

test("deferred pending backlog remains retryable", () => {
  assert.equal(historyDeliveryStatus({ complete: true, failed: false, capped: true }), 503);
});

test("authenticated poison notifications are acknowledged", () => {
  assert.equal(gmailPushStatus({ authenticated: true, poison: true }), 204);
  assert.equal(gmailPushStatus({ authenticated: false, poison: true }), 401);
  assert.equal(gmailPushStatus({ authenticated: true, poison: false }), 503);
});

test("missing watch state is a transient startup race", () => {
  assert.equal(gmailNotificationStatus({ authenticated: true, poison: false, hasWatchState: false }), 503);
});

test("only known permanent Gmail message statuses are tombstoned", () => {
  assert.equal(isPermanentGmailMessageStatus(400), true);
  assert.equal(isPermanentGmailMessageStatus(404), true);
  assert.equal(isPermanentGmailMessageStatus(401), false);
  assert.equal(isPermanentGmailMessageStatus(403), false);
  assert.equal(isPermanentGmailMessageStatus(408), false);
  assert.equal(isPermanentGmailMessageStatus(429), false);
  assert.equal(isPermanentGmailMessageStatus(500), false);
});

test("recovery baseline clears both scan fields only when complete", () => {
  assert.deepEqual(
    completedRecoveryState({
      lastHistoryId: "7",
      historyScanStartId: "3",
      historyPageToken: "page",
    }),
    {
      lastHistoryId: "7",
      historyScanStartId: null,
      historyPageToken: null,
    },
  );
  assert.equal(threadDiscoveryComplete(5_000), true);
  assert.equal(threadDiscoveryComplete(5_001), false);
});

test("summary-fetch catch preserves retryable staged rows and tombstones 404", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  for (const error of [
    new Error("connector failed"),
    new TypeError("invalid response"),
    new GmailHttpError(429),
  ]) {
    const transition = summaryFetchFailureTransition(error, now);
    assert.equal(transition.status, "pending");
    assert.equal(transition.backlog, true);
    assert.equal(transition.tombstonedAt, null);
    assert.equal(
      transition.nextAttemptAt.toISOString(),
      "2026-01-01T00:00:30.000Z",
    );
  }

  const permanent = summaryFetchFailureTransition(new GmailHttpError(404), now);
  assert.equal(permanent.status, "skipped");
  assert.equal(permanent.backlog, false);
  assert.equal(permanent.nextAttemptAt, null);
  assert.equal(permanent.tombstonedAt, now);
});