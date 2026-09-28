import assert from "node:assert/strict";
import test from "node:test";
import { autoInviteEligibility, AUTO_INVITE_REVIEW_DELAY_MS, MIN_INVITE_INTERVAL_MS } from "./osmCandidateWorkflow.ts";

const now = new Date("2026-09-28T12:00:00Z");
const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60_000);
const eligible = {
  reviewed: true, reviewedAt: daysAgo(4), highConfidence: true,
  suppressed: false, published: false, claimed: false, outreachBlocked: false,
  autoInviteEnabled: true, approvedContactEmail: "owner@example.com",
  contactEvidence: "Verified on the restaurant's official website",
  contactApprovedAt: daysAgo(3), inviteCount: 0,
};

test("automatic invitation requires both review and contact approval to age", () => {
  assert.equal(AUTO_INVITE_REVIEW_DELAY_MS, 2 * 24 * 60 * 60_000);
  assert.equal(autoInviteEligibility(eligible, undefined, now).status, "due");
  const young = autoInviteEligibility({ ...eligible, contactApprovedAt: daysAgo(1) }, undefined, now);
  assert.equal(young.status, "waiting");
  assert.equal(young.dueAt?.getTime(), daysAgo(1).getTime() + AUTO_INVITE_REVIEW_DELAY_MS);
  assert.equal(autoInviteEligibility({ ...eligible, reviewedAt: daysAgo(1) }, undefined, now).status, "waiting");
});

test("seventh-day spacing and three-attempt cap count failed reservations too", () => {
  assert.equal(MIN_INVITE_INTERVAL_MS, 7 * 24 * 60 * 60_000);
  const recent = { status: "failed", createdAt: daysAgo(2) };
  assert.equal(autoInviteEligibility({ ...eligible, inviteCount: 1 }, recent, now).status, "failed");
  assert.equal(autoInviteEligibility({ ...eligible, inviteCount: 1 }, { ...recent, createdAt: daysAgo(7) }, now).status, "due");
  assert.deepEqual(autoInviteEligibility({ ...eligible, inviteCount: 3 }, recent, now), { status: "failed", dueAt: null });
});

test("uncertain deliveries never become due; blocked or unapproved leads cannot send", () => {
  for (const status of ["reserved", "unknown"]) {
    assert.deepEqual(autoInviteEligibility(eligible, { status, createdAt: daysAgo(10) }, now), { status: "unknown", dueAt: null });
  }
  for (const change of [
    { autoInviteEnabled: false }, { reviewed: false }, { highConfidence: false },
    { approvedContactEmail: null }, { contactEvidence: null }, { suppressed: true },
    { published: true }, { claimed: true }, { outreachBlocked: true },
  ]) {
    assert.notEqual(autoInviteEligibility({ ...eligible, ...change }, undefined, now).status, "due");
  }
});