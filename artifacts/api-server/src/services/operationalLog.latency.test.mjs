import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = path.dirname(fileURLToPath(import.meta.url));
const result = await build({
  entryPoints: [path.join(directory, "operationalLog.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "isolate-alert-policy",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$/ }, (args) => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
        contents: args.path === "@workspace/db"
          ? "export const db = {}; export const operationalLogEventsTable = {};"
          : "export const and = ()=>{}; export const arrayContains = ()=>{}; export const desc = ()=>{}; export const eq = ()=>{}; export const gte = ()=>{}; export const inArray = ()=>{}; export const lt = ()=>{}; export const sql = ()=>{};",
      }));
    },
  }],
});
const { evaluateEngineLatencyAlert, engineLatencyAlertThresholdMs } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

const end = Date.UTC(2026, 0, 1, 12, 0);
const buckets = Array.from({ length: 5 }, (_, index) => ({
  minute: end - (index + 1) * 60_000,
  samples: 3,
  p95Ms: 2500,
}));

test("requires all five complete minutes above threshold with measured samples", () => {
  assert.equal(evaluateEngineLatencyAlert(buckets, end, 2000).status, "high");
  assert.equal(evaluateEngineLatencyAlert([], end, 2000).status, "insufficient_data");
  assert.equal(evaluateEngineLatencyAlert(buckets.slice(1), end, 2000).status, "insufficient_data");
  assert.equal(evaluateEngineLatencyAlert([...buckets.slice(0, 4), { ...buckets[4], samples: 2 }], end, 2000).status, "insufficient_data");
  assert.equal(evaluateEngineLatencyAlert([...buckets.slice(0, 4), { ...buckets[4], p95Ms: null }], end, 2000).status, "insufficient_data");
  assert.equal(evaluateEngineLatencyAlert([...buckets.slice(0, 4), { ...buckets[4], p95Ms: 2000 }], end, 2000).status, "normal");
  assert.equal(evaluateEngineLatencyAlert([...buckets, { minute: end, samples: 50, p95Ms: 9000 }], end, 2000).status, "high");
});

test("threshold is configurable but rejects invalid values", () => {
  const original = process.env.ENGINE_LATENCY_ALERT_THRESHOLD_MS;
  try {
    delete process.env.ENGINE_LATENCY_ALERT_THRESHOLD_MS;
    assert.equal(engineLatencyAlertThresholdMs(), 2000);
    process.env.ENGINE_LATENCY_ALERT_THRESHOLD_MS = "3500";
    assert.equal(engineLatencyAlertThresholdMs(), 3500);
    for (const invalid of ["0", "-1", "1.5", "abc", "600001"]) {
      process.env.ENGINE_LATENCY_ALERT_THRESHOLD_MS = invalid;
      assert.throws(() => engineLatencyAlertThresholdMs());
    }
  } finally {
    if (original === undefined) delete process.env.ENGINE_LATENCY_ALERT_THRESHOLD_MS;
    else process.env.ENGINE_LATENCY_ALERT_THRESHOLD_MS = original;
  }
});