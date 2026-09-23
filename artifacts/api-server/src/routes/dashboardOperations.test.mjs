import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function loadRoute() {
  const mocks = {
    "middleware/adminOnly": `export function adminOnly(req,res,next){res.set("Cache-Control","no-store");if(req.header("authorization")==="test-admin")return next();res.status(401).json({success:false,error:"Admin login required"});}`,
    "pipeline/insertService": `export function getInsertionQueueStatus(){return {pending:1,capacity:1000,draining:false,scope:"current_process",resetsOnRestart:true,secret:"do-not-send",items:[{jobId:"place-1",kind:"restaurant_insertion",label:"Safe name",city:"London",queuedAt:"2026-01-01T00:00:00.000Z",payload:{password:"hidden"},messageBody:"hidden"}]}}`,
    "services/engineHeartbeat": `export async function recordHeartbeat(){} export async function getEngineStatuses(){return {api:"online",ai:"offline",secret:"hidden"}}`,
    "services/operationalLog": `export async function getEnginePerformanceMetrics(){return {api:{total:2,successes:1,errors:1,avg_latency_ms:null,prompt:"hidden",response:"hidden"}}}`,
    "health/scraperHealth": `export function getRecentHealth(){return []} export function computeDailyHealthScore(){return null}`,
    "dashboardSystemHealth": `export async function getSystemHealthSnapshot(){return {checkedAt:"2026-01-01T00:00:00.000Z",scope:"current_process",services:{api:{status:"healthy",detail:"API is responding"}}}}`,
  };
  const output = await build({
    stdin: { contents: 'export {default} from "./dashboardOperations"', resolveDir: directory },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    banner: { js: `import {createRequire} from 'node:module'; const require=createRequire(${JSON.stringify(path.join(directory, "tests.cjs"))});` },
    plugins: [{
      name: "offline",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          const key = Object.keys(mocks).find((candidate) => args.path.endsWith(candidate));
          return key ? { path: key, namespace: "mock" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path] }));
      },
    }],
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`)).default;
}

test("operations routes require admin access and never expose source payload fields", async () => {
  const express = require("express");
  const app = express();
  app.use("/dashboard", await loadRoute());
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/dashboard/operations`;
  try {
    for (const view of ["queue", "engines", "health"]) {
      const denied = await fetch(`${base}/${view}`);
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get("cache-control"), "no-store");

      const allowed = await fetch(`${base}/${view}`, {
        headers: { authorization: "test-admin" },
      });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get("cache-control"), "no-store");
      const body = await allowed.text();
      for (const sensitive of ["do-not-send", "password", "messageBody", "prompt", "response"]) {
        assert.ok(!body.includes(sensitive), `${view} leaked ${sensitive}`);
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});