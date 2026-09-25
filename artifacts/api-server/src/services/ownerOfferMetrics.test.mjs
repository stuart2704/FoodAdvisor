import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

test("server-side offer measurement persists only UTC day, fixed event, and count", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "owner-offer-metrics-"));
  try {
    const output = path.join(directory, "metrics.mjs");
    await build({
      entryPoints: [new URL("./ownerOfferMetrics.ts", import.meta.url).pathname],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
      plugins: [{
        name: "metric-db-mock",
        setup(buildContext) {
          buildContext.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$/ }, ({ path: moduleName }) =>
            ({ path: moduleName, namespace: "metric-db-mock" }));
          buildContext.onLoad({ filter: /.*/, namespace: "metric-db-mock" }, ({ path: moduleName }) => ({
            contents: moduleName === "@workspace/db"
              ? `export const ownerOfferMetricsTable = { day: "day", event: "event", count: "count" };
                 export const db = { insert() { return { values(record) {
                   globalThis.__offerMetricWrites.push(record);
                   return { async onConflictDoUpdate() {} };
                 } }; } };`
              : "export const sql = () => 'increment';",
            loader: "js",
          }));
        },
      }],
    });
    globalThis.__offerMetricWrites = [];
    const { recordOwnerOfferOutcome } = await import(pathToFileURL(output).href);
    await recordOwnerOfferOutcome("owner_offer_published");
    assert.deepEqual(globalThis.__offerMetricWrites, [{
      day: new Date().toISOString().slice(0, 10),
      event: "owner_offer_published",
      count: 1,
    }]);
    assert.deepEqual(Object.keys(globalThis.__offerMetricWrites[0]).sort(), ["count", "day", "event"]);
  } finally {
    delete globalThis.__offerMetricWrites;
    await rm(directory, { recursive: true, force: true });
  }
});