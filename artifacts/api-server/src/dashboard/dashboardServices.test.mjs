import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
async function load(entry, mocks) {
  const output = await build({
    stdin: { contents: entry, resolveDir: directory }, bundle: true, write: false,
    platform: "node", format: "esm",
    banner: { js: `import {createRequire} from 'node:module'; const require=createRequire(${JSON.stringify(path.join(directory, "tests.cjs"))});` },
    plugins: [{ name: "offline", setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        const key = Object.keys(mocks).find((key) => args.path.endsWith(key));
        return key ? { path: key, namespace: "mock" } : undefined;
      });
      b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path] }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
}
const logMock = "export function logEvent(){} export function logError(){}";

test("health is bounded, redacted, copied and scored only from today's samples", async () => {
  const m = await load('export * from "../health/scraperHealth"', {
    "dashboard/eventsFeed": logMock,
    "lib/restaurant-import": 'export const SUPPORTED_CITIES=["London"];',
  });
  assert.equal(m.computeDailyHealthScore(), null);
  const record = { timestamp: new Date(Date.now() - 1000).toISOString(), city: "London",
    mapsSuccess: true, websiteSuccess: null, proxyUsed: "http://user:private@proxy.example.org",
    durationMs: 200, errors: [] };
  m.recordScraperHealth({ ...record, timestamp: new Date(Date.now() - 86400000).toISOString() });
  assert.equal(m.computeDailyHealthScore(), null);
  m.recordScraperHealth(record);
  assert.equal(m.computeDailyHealthScore(), 100);
  record.errors.push("later mutation");
  const result = m.getRecentHealth(1)[0];
  assert.equal(result.proxyUsed, "redacted");
  assert.equal(result.errors.length, 0);
  result.errors.push("mutation");
  assert.equal(m.getRecentHealth(1)[0].errors.length, 0);
  assert.deepEqual(m.getRecentHealth(0), []);
  assert.throws(() => m.getRecentHealth(-1));
  m.recordScraperHealth({ ...record, mapsSuccess: false, websiteSuccess: false, durationMs: 21000,
    errors: ["network failure with confidential content"] });
  assert.equal(m.computeDailyHealthScore(), 86);
  assert.deepEqual(m.getRecentHealth(1)[0].errors, ["network_error"]);
  for (let i = 0; i < 510; i++) m.recordScraperHealth({ ...record, errors: [] });
  assert.equal(m.getRecentHealth(500).length, 500);
});

test("error summary returns only grouped error categories", async () => {
  const m = await load('export * from "./errorSummary"', {
    "utils/eventLog": `export function getEvents(){return [
      {type:"info",category:"network_error"},{type:"error",category:"network_error"},
      {type:"error",category:"network_error"},{type:"error"},{type:"error",category:"http://private"}
    ];}`,
  });
  assert.deepEqual({ ...m.getErrorSummary() }, { network_error: 2, unknown: 2 });
});

test("status counts use workflow mapping and fail explicitly on query failure", async () => {
  const m = await load('export * from "./statusStats";export {state} from "@workspace/db"', {
    "@workspace/db": `export const restaurantsTable={};export const state={fail:false,sql:""};
      export const db={select(fields){state.sql=fields.status.text;return {from(){return this},groupBy(){return this},async orderBy(){if(state.fail)throw Error("confidential");return [{status:"engaged",count:2}];}}}};`,
    "drizzle-orm": 'export function sql(parts){return {text:parts.join("COLUMN"),mapWith(){return this}}}',
    "/eventsFeed": logMock,
  });
  assert.deepEqual(await m.getStatusCounts(), [{ status: "engaged", count: 2 }]);
  for (const label of ["closed", "not_contacted", "followup_sent", "final_followup_sent", "engaged", "unmapped"]) {
    assert.ok(m.state.sql.includes(`'${label}'`));
  }
  m.state.fail = true;
  await assert.rejects(() => m.getStatusCounts(), /^Error: Dashboard status counts are unavailable\.$/);
});

test("all five dashboard endpoints require auth, preserve event shape and return 503 for failed queries", async () => {
  const m = await load('export * from "./dashboardAPI";export {state} from "./statusStats"', {
    "lib/automation-auth": 'export const validAutomationToken=(value)=>value==="Bearer offline-test";',
    "utils/eventLog": 'export function getEvents(){return [{time:"2026-01-01T00:00:00.000Z",type:"info",message:"Test"}]}',
    "health/scraperHealth": "export function getRecentHealth(){return []}export function computeDailyHealthScore(){return null}",
    "/statusStats": 'export const state={fail:false,calls:0};export async function getStatusCounts(){state.calls++;if(state.fail)throw Error("confidential");return [{status:"contacted",count:2}]}',
    "/errorSummary": 'export function getErrorSummary(){return {unknown:1}}',
  });
  const express = require("express");
  const app = express();
  app.use("/dashboard", m.dashboardRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/dashboard`;
  try {
    for (const endpoint of ["events", "health", "status", "errors", "summary"]) {
      const response = await fetch(`${base}/${endpoint}`);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal(m.state.calls, 0);
    const headers = { authorization: "Bearer offline-test" };
    const events = await (await fetch(`${base}/events`, { headers })).json();
    assert.equal(events[0].time, "2026-01-01T00:00:00.000Z");
    assert.equal(events[0].timestamp, undefined);
    const health = await (await fetch(`${base}/health`, { headers })).json();
    assert.equal(health.score, null);
    const summary = await (await fetch(`${base}/summary`, { headers })).json();
    assert.equal(summary.statusCounts[0].count, 2);
    const errors = await (await fetch(`${base}/errors`, { headers })).json();
    assert.deepEqual(errors, { unknown: 1 });
    m.state.fail = true;
    for (const endpoint of ["status", "summary"]) {
      const response = await fetch(`${base}/${endpoint}`, { headers });
      assert.equal(response.status, 503);
      assert.ok(!(await response.text()).includes("confidential"));
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});