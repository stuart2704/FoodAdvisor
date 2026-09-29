import assert from "node:assert/strict";
import test from "node:test";
import { instantlyRequest } from "./instantlyClient.ts";

test("missing project secret prevents any Instantly request", async () => {
  const previous = process.env.INSTANTLY_API_KEY;
  const originalFetch = globalThis.fetch;
  delete process.env.INSTANTLY_API_KEY;
  globalThis.fetch = async () => {
    throw new Error("A request must not be made without a key.");
  };
  try {
    await assert.rejects(
      () => instantlyRequest("/v2/campaigns"),
      /INSTANTLY_API_KEY must be configured as a project secret/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.INSTANTLY_API_KEY;
    else process.env.INSTANTLY_API_KEY = previous;
  }
});

test("uses only the Instantly v2 origin and sends JSON with a bearer credential", async () => {
  const previous = process.env.INSTANTLY_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.INSTANTLY_API_KEY = "test-key-only";
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests += 1;
    assert.equal(input, "https://api.instantly.ai/api/v2/campaigns");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-key-only");
    assert.deepEqual(JSON.parse(String(init?.body)), { name: "test" });
    return new Response(JSON.stringify({ id: "test-id" }), { status: 200 });
  };
  try {
    await assert.rejects(() => instantlyRequest("//other-host/v2/campaigns"), /Invalid Instantly API path/);
    assert.equal(requests, 0);
    const response = await instantlyRequest("/v2/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { name: "test" },
    });
    assert.equal(response.ok, true);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.INSTANTLY_API_KEY;
    else process.env.INSTANTLY_API_KEY = previous;
  }
});