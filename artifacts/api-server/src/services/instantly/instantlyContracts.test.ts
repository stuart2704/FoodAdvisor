import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCancellationBatchComplete,
  CANCELLATION_BATCH_LIMIT,
  campaignEmailsPath,
  hasCompleteInstantlyDirection,
  instantlyActivationEnabled,
  matchesInstantlyOwnership,
  matchesInstantlySentOwnership,
  normaliseInstantlyEmail,
  receivedEmailsPath,
  singleStepCampaignPayload,
  validInstantlyProviderId,
} from "./instantlyContracts.ts";

const campaignId = "01a08b36-6993-726d-acd3-8041757f9758";

test("Instantly received-email polling uses the v2 endpoint and a bounded page", () => {
  const path = receivedEmailsPath("sender@example.com");
  assert.match(path, /^\/v2\/emails\?/);
  assert.match(path, /email_type=received/);
  assert.match(path, /eaccount=sender%40example\.com/);
  assert.match(path, /limit=100/);
  assert.match(receivedEmailsPath("sender@example.com", campaignId), /starting_after=01a08b36/);
  const sentPath = campaignEmailsPath(campaignId, "sender@example.com", campaignId);
  assert.match(sentPath, /campaign_id=01a08b36/);
  assert.match(sentPath, /eaccount=sender%40example\.com/);
  assert.match(sentPath, /email_type=sent/);
  assert.match(sentPath, /starting_after=01a08b36/);
});

test("Instantly v2 fixture uses one exact UTC-date email step", () => {
  const payload = singleStepCampaignPayload("Hello", "First line\nSecond line", "2026-05-04");
  assert.deepEqual(payload.campaign_schedule, {
    schedules: [{
      name: "single-day, single-lead delivery",
      timing: { from: "00:00", to: "23:59" },
      days: { "0": true, "1": true, "2": true, "3": true, "4": true, "5": true, "6": true },
      timezone: "Etc/UTC",
    }],
    start_date: "2026-05-04",
    end_date: "2026-05-04",
  });
  assert.deepEqual(payload.sequences, [{
    steps: [{
      type: "email",
      delay: 0,
      delay_unit: "days",
      variants: [{ subject: "Hello", body: "First line<br>Second line", v_disabled: false }],
    }],
  }]);
  assert.equal(payload.daily_limit, 1);
  assert.equal(payload.daily_max_leads, 1);
});

test("Instantly ownership requires the locally mapped campaign, recipient and mailbox", () => {
  const mapping = {
    campaignId,
    recipientEmail: "owner@example.com",
    eaccount: "sender@example.com",
  };
  assert.equal(matchesInstantlyOwnership(mapping, {
    campaignId,
    eaccount: "sender@example.com",
    emailType: "received",
    from: "owner@example.com",
    recipients: ["sender@example.com"],
  }), true);
  assert.equal(matchesInstantlyOwnership(mapping, {
    campaignId,
    eaccount: "sender@example.com",
    emailType: "received",
    from: "attacker@example.com",
    recipients: ["sender@example.com"],
  }), false);
  assert.equal(matchesInstantlyOwnership(mapping, {
    campaignId: "01a08b36-6993-726d-acd3-8041757f9759",
    eaccount: "sender@example.com",
    emailType: "received",
    from: "owner@example.com",
    recipients: ["sender@example.com"],
  }), false);
  assert.equal(matchesInstantlySentOwnership(mapping, {
    campaignId,
    eaccount: "sender@example.com",
    emailType: "sent",
    from: "sender@example.com",
    recipients: ["owner@example.com"],
  }), true);
  assert.equal(matchesInstantlySentOwnership(mapping, {
    campaignId,
    eaccount: "sender@example.com",
    emailType: "received",
    from: "owner@example.com",
    recipients: ["sender@example.com"],
  }), false);
  assert.equal(hasCompleteInstantlyDirection({
    id: campaignId,
    eaccount: "sender@example.com",
    emailType: "received",
    from: null,
    recipients: ["sender@example.com"],
  }), false);
});

test("Instantly identifiers and configured mailboxes are validated before use", () => {
  assert.equal(validInstantlyProviderId(campaignId), true);
  assert.equal(validInstantlyProviderId("subject-id"), false);
  assert.equal(normaliseInstantlyEmail(" Owner@Example.com "), "owner@example.com");
  assert.equal(normaliseInstantlyEmail("not an email"), null);
  assert.equal(instantlyActivationEnabled({}), false);
  assert.equal(instantlyActivationEnabled({ INSTANTLY_CAMPAIGN_ACTIVATION_ENABLED: "true" }), true);
});

test("cancellation backlog above the guarded batch fails closed", () => {
  assert.doesNotThrow(() => assertCancellationBatchComplete(CANCELLATION_BATCH_LIMIT, false));
  assert.throws(
    () => assertCancellationBatchComplete(CANCELLATION_BATCH_LIMIT, true),
    /backlog exceeds the safe batch limit/,
  );
});