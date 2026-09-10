import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/instantly-webhook-offline-test";

const {
  authenticateInstantlyWebhook,
  createInstantlyWebhookHandler,
} = await import("./instantlyWebhook.ts");

const secret = "b".repeat(40);
const campaignId = "01a08b36-6993-726d-acd3-8041757f9758";

function responseRecorder() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    ended: false,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(value: unknown) {
      response.body = value;
      return response;
    },
    end() {
      response.ended = true;
      return response;
    },
  };
  return response;
}

function request(headers: Record<string, string>, body: unknown) {
  return { headers, body } as never;
}

async function withWebhookEnvironment(
  values: Record<string, string | undefined>,
  callback: () => Promise<void> | void,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of [
    "INSTANTLY_WEBHOOK_ENABLED",
    "INSTANTLY_WEBHOOK_SECRET",
    "INSTANTLY_WEBHOOK_HEADER_SECRET",
  ]) {
    previous.set(key, process.env[key]);
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("unauthenticated webhook requests stop before provider reconciliation", async () => {
  await withWebhookEnvironment({
    INSTANTLY_WEBHOOK_ENABLED: "true",
    INSTANTLY_WEBHOOK_SECRET: secret,
  }, async () => {
    let providerCalls = 0;
    let nextCalls = 0;
    const response = responseRecorder();
    authenticateInstantlyWebhook(
      request({}, {}),
      response as never,
      () => { nextCalls += 1; },
    );
    assert.equal(response.statusCode, 401);
    assert.equal(nextCalls, 0);
    assert.equal(providerCalls, 0);
  });
});

test("missing webhook secret fails closed with 503 and does not call a provider", async () => {
  await withWebhookEnvironment({
    INSTANTLY_WEBHOOK_ENABLED: "true",
    INSTANTLY_WEBHOOK_SECRET: undefined,
  }, async () => {
    let nextCalls = 0;
    const response = responseRecorder();
    authenticateInstantlyWebhook(
      request({ authorization: `Bearer ${secret}` }, {}),
      response as never,
      () => { nextCalls += 1; },
    );
    assert.equal(response.statusCode, 503);
    assert.equal(nextCalls, 0);
  });
});

test("provider failure remains retryable and a later delivery is acknowledged", async () => {
  await withWebhookEnvironment({
    INSTANTLY_WEBHOOK_ENABLED: "true",
    INSTANTLY_WEBHOOK_SECRET: secret,
  }, async () => {
    let providerCalls = 0;
    const reconcile = async () => {
      providerCalls += 1;
      if (providerCalls === 1) throw new Error("offline provider");
      return { processed: 1, skipped: 0, failed: 0 };
    };
    const handler = createInstantlyWebhookHandler(reconcile);
    const payload = {
      event_type: "reply_received",
      campaign_id: campaignId,
      reply_text: "This is a reply.",
    };

    const firstResponse = responseRecorder();
    authenticateInstantlyWebhook(
      request({ authorization: `Bearer ${secret}` }, payload),
      firstResponse as never,
      () => undefined,
    );
    await handler(
      request({ authorization: `Bearer ${secret}` }, payload),
      firstResponse as never,
      () => undefined,
    );
    assert.equal(firstResponse.statusCode, 503);

    const secondResponse = responseRecorder();
    authenticateInstantlyWebhook(
      request({ authorization: `Bearer ${secret}` }, payload),
      secondResponse as never,
      () => undefined,
    );
    await handler(
      request({ authorization: `Bearer ${secret}` }, payload),
      secondResponse as never,
      () => undefined,
    );
    assert.equal(secondResponse.statusCode, 204);
    assert.equal(providerCalls, 2);
  });
});

test("webhook campaign and restaurant-like fields are never passed to reconciliation", async () => {
  await withWebhookEnvironment({
    INSTANTLY_WEBHOOK_ENABLED: "true",
    INSTANTLY_WEBHOOK_SECRET: secret,
  }, async () => {
    let receivedArguments: unknown[] | undefined;
    const handler = createInstantlyWebhookHandler(async (...args) => {
      receivedArguments = args;
      return { processed: 0, skipped: 1, failed: 0 };
    });
    const response = responseRecorder();
    const payload = {
      event_type: "reply_received",
      campaign_id: campaignId,
      restaurant_id: "forged-restaurant",
      variables: { restaurant_id: "forged-restaurant" },
      subject: "ID:123",
    };
    await handler(
      request({ authorization: `Bearer ${secret}` }, payload),
      response as never,
      () => undefined,
    );
    assert.deepEqual(receivedArguments, []);
    assert.equal(response.statusCode, 204);
  });
});