import assert from "node:assert/strict";
import test from "node:test";
import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
import {
  UNSUBSCRIBE_PLACEHOLDER,
  addSequenceStep,
  attachMailbox,
  buildFullOutreachSequence,
} from "./instantlySequenceBuilder.ts";

const campaignId = "01a08b36-6993-726d-acd3-8041757f9758";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type ProxyCall = {
  connector: string;
  path: string;
  options?: ProxyOptions;
};

async function withProxy(
  handler: (call: ProxyCall) => Response | Promise<Response>,
  operation: (calls: ProxyCall[]) => Promise<void>,
): Promise<void> {
  const calls: ProxyCall[] = [];
  const original = ReplitConnectors.prototype.proxy;
  ReplitConnectors.prototype.proxy = async function mockProxy(
    connector: string,
    path: string,
    options?: ProxyOptions,
  ): Promise<Response> {
    const call = { connector, path, options };
    calls.push(call);
    return handler(call);
  };
  try {
    await operation(calls);
  } finally {
    ReplitConnectors.prototype.proxy = original;
  }
}

function setCreationFlag(value: string | undefined): string | undefined {
  const previous = process.env.INSTANTLY_CAMPAIGN_CREATION_ENABLED;
  if (value === undefined) delete process.env.INSTANTLY_CAMPAIGN_CREATION_ENABLED;
  else process.env.INSTANTLY_CAMPAIGN_CREATION_ENABLED = value;
  return previous;
}

function restoreCreationFlag(previous: string | undefined): void {
  if (previous === undefined) delete process.env.INSTANTLY_CAMPAIGN_CREATION_ENABLED;
  else process.env.INSTANTLY_CAMPAIGN_CREATION_ENABLED = previous;
}

test("full template is one inactive create request with day 0/3/7 timing", async () => {
  const previous = setCreationFlag("true");
  try {
    await withProxy((call) => {
      if (call.path === "/v2/accounts/sender%40example.com") {
        return jsonResponse({ email: "sender@example.com", status: 1 });
      }
      if (call.path === "/v2/campaigns") {
        return jsonResponse({ id: campaignId, status: 0 });
      }
      throw new Error(`unexpected test path: ${call.path}`);
    }, async (calls) => {
      const result = await buildFullOutreachSequence(" Sender@Example.com ");
      assert.equal(result, campaignId);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].connector, "instantly");
      assert.equal(calls[1].options?.method, "POST");

      const payload = calls[1].options?.body as Record<string, unknown>;
      assert.deepEqual(payload.email_list, ["sender@example.com"]);
      assert.equal(payload.insert_unsubscribe_header, true);
      assert.equal(payload.stop_on_reply, true);
      assert.equal(payload.stop_on_auto_reply, true);
      assert.equal(payload.link_tracking, false);
      assert.equal(payload.open_tracking, false);
      const steps = (payload.sequences as Array<{ steps: Array<Record<string, unknown>> }>)[0].steps;
      assert.deepEqual(steps.map((step) => step.delay), [3, 4, 0]);
      assert.deepEqual(steps.map((step) => step.delay_unit), ["days", "days", "days"]);
      for (const step of steps) {
        const variant = (step.variants as Array<{ body: string }>)[0];
        assert.ok(variant.body.includes(`Unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}`));
      }
      assert.equal(calls.some((call) => call.path.includes("/leads")), false);
      assert.equal(calls.some((call) => call.path.endsWith("/activate")), false);
    });
  } finally {
    restoreCreationFlag(previous);
  }
});

test("creation guard prevents mailbox lookup and mutation", async () => {
  const previous = setCreationFlag("false");
  try {
    await withProxy(() => {
      throw new Error("the connector must not be called");
    }, async (calls) => {
      await assert.rejects(
        () => buildFullOutreachSequence("sender@example.com"),
        /sequence creation is disabled/,
      );
      assert.equal(calls.length, 0);
    });
  } finally {
    restoreCreationFlag(previous);
  }
});

test("mailbox validation requires the exact managed account", async () => {
  const previous = setCreationFlag("true");
  try {
    await withProxy((call) => {
      if (call.path === "/v2/accounts/sender%40example.com") {
        return jsonResponse({ email: "different@example.com", status: 1 });
      }
      throw new Error(`unexpected test path: ${call.path}`);
    }, async (calls) => {
      await assert.rejects(
        () => buildFullOutreachSequence("sender@example.com"),
        /does not match a managed account/,
      );
      assert.equal(calls.length, 1);
    });
  } finally {
    restoreCreationFlag(previous);
  }
});

test("helpers refuse to edit an active campaign", async () => {
  const previous = setCreationFlag("true");
  try {
    await withProxy((call) => {
      if (call.path === `/v2/campaigns/${campaignId}`) {
        return jsonResponse({ id: campaignId, status: 1 });
      }
      throw new Error(`unexpected test path: ${call.path}`);
    }, async (calls) => {
      await assert.rejects(
        () => addSequenceStep(campaignId, 1, "Subject", "Body"),
        /not an inactive draft/,
      );
      assert.equal(calls.length, 1);
      assert.equal(calls[0].options?.method, undefined);
    });
  } finally {
    restoreCreationFlag(previous);
  }
});

test("attachMailbox validates the account and patches only an inactive draft", async () => {
  const previous = setCreationFlag("true");
  try {
    await withProxy((call) => {
      if (call.path === "/v2/accounts/sender%40example.com") {
        return jsonResponse({ email: "sender@example.com", status: 1 });
      }
      if (call.path === `/v2/campaigns/${campaignId}` && !call.options?.method) {
        return jsonResponse({ id: campaignId, status: 0 });
      }
      if (call.path === `/v2/campaigns/${campaignId}` && call.options?.method === "PATCH") {
        return jsonResponse({ id: campaignId, status: 0 });
      }
      throw new Error(`unexpected test path: ${call.path}`);
    }, async (calls) => {
      assert.equal(await attachMailbox(campaignId, "sender@example.com"), true);
      assert.equal(calls.length, 3);
      const patch = calls[2].options?.body as Record<string, unknown>;
      assert.deepEqual(patch.email_list, ["sender@example.com"]);
    });
  } finally {
    restoreCreationFlag(previous);
  }
});

test("provider failures and timeouts are explicit safe errors", async () => {
  const previousCreation = setCreationFlag("true");
  const previousTimeout = process.env.INSTANTLY_SEQUENCE_BUILDER_TIMEOUT_MS;
  process.env.INSTANTLY_SEQUENCE_BUILDER_TIMEOUT_MS = "5";
  try {
    await withProxy(
      () => new Promise<Response>(() => {}),
      async () => {
        await assert.rejects(
          () => buildFullOutreachSequence("sender@example.com"),
          /request timed out/,
        );
      },
    );
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.INSTANTLY_SEQUENCE_BUILDER_TIMEOUT_MS;
    } else {
      process.env.INSTANTLY_SEQUENCE_BUILDER_TIMEOUT_MS = previousTimeout;
    }
    restoreCreationFlag(previousCreation);
  }
});