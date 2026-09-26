import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

test("both AI aliases produce measured AI samples without retaining request data", async () => {
  const events = [];
  globalThis.__httpLatencyEvents = events;
  const compiled = await build({
    entryPoints: [path.join(directory, "httpLatency.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "safe-event-sink",
      setup(builder) {
        builder.onResolve({ filter: /utils\/eventLog$/ }, () => ({
          path: "eventLog", namespace: "mock",
        }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: "export function logEvent(...args) { globalThis.__httpLatencyEvents.push(args); }",
        }));
      },
    }],
  });
  const { sampledHttpEngines, recordSampledHttpLatency } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
  );
  assert.deepEqual(sampledHttpEngines("/ai/describe"), ["ai"]);
  assert.deepEqual(sampledHttpEngines("/api/ai/describe"), ["api", "ai"]);
  assert.deepEqual(sampledHttpEngines("/api/healthz"), []);

  const express = require("express");
  const app = express();
  app.use(recordSampledHttpLatency);
  app.get(["/ai/describe", "/api/ai/describe"], (_req, res) => res.json({ answer: "not logged" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    for (const alias of ["/ai/describe", "/api/ai/describe"]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${alias}?prompt=secret`);
      assert.equal(response.status, 200);
      await response.body.cancel();
    }
    const ai = events.filter(([engine]) => engine === "ai");
    assert.equal(ai.length, 2);
    assert.equal(events.filter(([engine]) => engine === "api").length, 1);
    assert.ok(ai.every(([, message, category, tags, duration]) =>
      message === "Sampled AI HTTP operation completed" &&
      category === "success" && tags.length === 0 &&
      Number.isFinite(duration) && duration >= 0
    ));
    assert.doesNotMatch(JSON.stringify(events), /secret|prompt|answer|describe/);
  } finally {
    Math.random = originalRandom;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    delete globalThis.__httpLatencyEvents;
  }
});