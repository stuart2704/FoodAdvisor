import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const output = await build({
  entryPoints: [fileURLToPath(new URL("../../../restaurant-advisor-web/src/lib/dashboard-api.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);

test("dashboard client uses same-origin paths, optional per-call auth and data wrappers", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ fixture: true }), { status: 200 });
  };
  try {
    for (const endpoint of ["Events", "Health", "Status", "Errors", "Summary"]) {
      const result = await api[`get${endpoint}`]();
      assert.equal(result.data.fixture, true);
      assert.equal(result.status, 200);
      const last = calls.at(-1);
      assert.equal(last.url, `/dashboard/${endpoint.toLowerCase()}`);
      assert.equal(last.options.cache, "no-store");
      assert.equal(last.options.headers.get("authorization"), null);
    }
    await api.getHealth({ token: "offline-fixture-only" });
    assert.equal(calls.at(-1).options.headers.get("authorization"), "Bearer offline-fixture-only");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test("client errors hide response details and cancellation reaches fetch", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  try {
    for (const status of [401, 403, 503]) {
      globalThis.fetch = async () => new Response("private provider details", { status });
      await assert.rejects(() => api.getStatus(), (error) =>
        error instanceof api.DashboardApiError && error.status === status
        && !error.message.includes("private"));
    }
    globalThis.fetch = async () => new Response("invalid json", { status: 200 });
    await assert.rejects(() => api.getStatus(), /unreadable response/);
    globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    });
    const controller = new AbortController();
    const request = api.getHealth({ signal: controller.signal });
    controller.abort();
    await assert.rejects(() => request, { name: "AbortError" });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});