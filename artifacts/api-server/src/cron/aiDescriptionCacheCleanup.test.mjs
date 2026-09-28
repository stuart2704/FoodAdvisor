import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-cache-cleanup-"));
const output = path.join(tempDir, "cleanup.mjs");
globalThis.__aiCacheCleanup = {
  queries: [],
  logs: [],
  schedules: [],
  rowCount: 0,
};

await build({
  entryPoints: [path.resolve(import.meta.dirname, "aiDescriptionCacheCleanup.ts")],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "cleanup-mocks",
    setup(pluginBuild) {
      pluginBuild.onResolve(
        { filter: /^@workspace\/db$|^node-cron$|^\.\.\/lib\/logger$/ },
        (args) => ({ path: args.path, namespace: "cleanup-mock" }),
      );
      pluginBuild.onLoad({ filter: /.*/, namespace: "cleanup-mock" }, (args) => ({
        loader: "js",
        contents: {
          "@workspace/db": `export const pool = {
            async query(text, values) {
              const state = globalThis.__aiCacheCleanup;
              state.queries.push({ text, values });
              if (state.failure) throw state.failure;
              if (state.wait) await state.wait;
              return { rowCount: state.rowCount };
            },
          };`,
          "node-cron": `export default {
            schedule(expression, callback, options) {
              const task = { expression, callback, options };
              globalThis.__aiCacheCleanup.schedules.push(task);
              return task;
            },
          };`,
          "../lib/logger": `export const logger = {
            info(...args) { globalThis.__aiCacheCleanup.logs.push(["info", ...args]); },
            error(...args) { globalThis.__aiCacheCleanup.logs.push(["error", ...args]); },
          };`,
        }[args.path],
      }));
    },
  }],
  logLevel: "silent",
});

const { cleanupExpiredAiDescriptions, startAiDescriptionCacheCleanup } =
  await import(pathToFileURL(output).href);
const state = globalThis.__aiCacheCleanup;
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("deletes at most one batch of expired descriptions and abandoned reservations", async () => {
  state.rowCount = 17;
  const now = new Date("2026-09-25T12:00:00Z");
  assert.equal(await cleanupExpiredAiDescriptions(now), 17);
  assert.equal(state.queries.length, 1);
  const { text, values } = state.queries[0];
  assert.deepEqual(values, [now, 200]);
  assert.match(text, /expires_at <= \$1/);
  assert.doesNotMatch(text, /description IS NOT NULL/);
  assert.match(text, /ORDER BY expires_at, cache_key\s+LIMIT \$2\s+FOR UPDATE SKIP LOCKED/);
  assert.match(text, /DELETE FROM ai_description_cache AS cache\s+USING expired/);
});

test("schedules hourly UTC cleanup, skips overlap, and logs failures without throwing", async () => {
  state.queries.length = 0;
  state.rowCount = 0;
  const task = startAiDescriptionCacheCleanup();
  assert.equal(startAiDescriptionCacheCleanup(), task);
  assert.equal(state.schedules.length, 1);
  assert.equal(task.expression, "15 * * * *");
  assert.equal(task.options.timezone, "Etc/UTC");
  assert.equal(task.options.noOverlap, true);
  await flush();

  let release;
  state.wait = new Promise((resolve) => { release = resolve; });
  task.callback();
  task.callback();
  assert.equal(state.queries.length, 2); // one startup batch, one scheduled batch
  release();
  await flush();
  state.wait = null;

  state.failure = new Error("database unavailable");
  task.callback();
  await flush();
  assert.equal(state.logs.at(-1)[0], "error");
  assert.match(state.logs.at(-1)[2], /cleanup failed/);
  state.failure = null;
  task.callback();
  await flush();
  assert.equal(state.logs.at(-1)[0], "info");
});

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
  delete globalThis.__aiCacheCleanup;
});