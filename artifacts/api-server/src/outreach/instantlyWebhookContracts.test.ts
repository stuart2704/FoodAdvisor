import assert from "node:assert/strict";
import test from "node:test";
import {
  hasValidInstantlyWebhookSecret,
  instantlyWebhookConfigured,
  instantlyWebhookEnabled,
  INSTANTLY_REPLY_RECEIVED_EVENT,
  parseInstantlyWebhookPayload,
} from "./instantlyWebhookContracts.ts";

const secret = "a".repeat(40);
const campaignId = "01a08b36-6993-726d-acd3-8041757f9758";

test("webhook authentication is disabled and unconfigured by default", () => {
  assert.equal(instantlyWebhookEnabled({}), false);
  assert.equal(instantlyWebhookConfigured({}), false);
  assert.equal(
    hasValidInstantlyWebhookSecret({ authorization: `Bearer ${secret}` }, {}),
    false,
  );
});

test("webhook authentication accepts documented custom headers with constant-size comparison", () => {
  const environment = {
    INSTANTLY_WEBHOOK_ENABLED: "true",
    INSTANTLY_WEBHOOK_SECRET: secret,
  };
  assert.equal(instantlyWebhookConfigured(environment), true);
  assert.equal(
    hasValidInstantlyWebhookSecret({ authorization: `Bearer ${secret}` }, environment),
    true,
  );
  assert.equal(
    hasValidInstantlyWebhookSecret({ "x-instantly-webhook-secret": secret }, environment),
    true,
  );
  assert.equal(
    hasValidInstantlyWebhookSecret({ authorization: "Bearer forged" }, environment),
    false,
  );
  assert.equal(
    hasValidInstantlyWebhookSecret({ "x-instantly-webhook-secret": secret }, {}),
    false,
  );
});

test("current reply_received payload fields are accepted without trusting lead fields", () => {
  const payload = parseInstantlyWebhookPayload({
    timestamp: "2026-01-01T00:00:00.000Z",
    event_type: INSTANTLY_REPLY_RECEIVED_EVENT,
    workspace: "workspace-id",
    campaign_id: campaignId,
    campaign_name: "provider campaign",
    lead_email: "owner@example.com",
    email_account: "sender@example.com",
    reply_text_snippet: "Yes",
    reply_subject: "Re: hello",
    reply_text: "Yes, please send details.",
    reply_html: "<p>Yes</p>",
    variables: { restaurant_id: "forged-place-id" },
    subject: "ID:999999",
  });
  assert.equal(payload?.eventType, INSTANTLY_REPLY_RECEIVED_EVENT);
  assert.equal(payload?.campaignId, campaignId);
  assert.equal("restaurantId" in (payload ?? {}), false);
});

test("forged campaign IDs and oversized provider fields are rejected as payloads", () => {
  assert.equal(parseInstantlyWebhookPayload({
    event_type: INSTANTLY_REPLY_RECEIVED_EVENT,
    campaign_id: "restaurant-123",
  }), null);
  assert.equal(parseInstantlyWebhookPayload({
    event_type: INSTANTLY_REPLY_RECEIVED_EVENT,
    campaign_id: campaignId,
    reply_text: "x".repeat(20_001),
  }), null);
});