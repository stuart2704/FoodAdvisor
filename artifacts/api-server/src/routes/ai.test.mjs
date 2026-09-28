import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const apiRoot = path.resolve(import.meta.dirname, "../..");
const source = path.join(apiRoot, "src/routes/ai.ts");

const dbMock = String.raw`
const column = (name) => ({ name });
export const aiDescriptionCacheTable = {
  cacheKey: column("cacheKey"),
  restaurantId: column("restaurantId"),
  description: column("description"),
  expiresAt: column("expiresAt"),
  createdAt: column("createdAt"),
  updatedAt: column("updatedAt"),
};
const state = () => globalThis.__aiRouteState;
const matches = (condition, row) => {
  if (!condition) return true;
  if (condition.kind === "and") return condition.conditions.every((item) => matches(item, row));
  if (condition.kind === "eq") return row[condition.column.name] === condition.value;
  if (condition.kind === "lte") return row[condition.column.name] <= condition.value;
  if (condition.kind === "gt") return row[condition.column.name] > condition.value;
  if (condition.kind === "isNull") return row[condition.column.name] == null;
  return false;
};
const project = (selection, row) => Object.fromEntries(
  Object.entries(selection).map(([key, selected]) => [key, row[selected.name]]),
);
export const db = {
  select(selection) {
    return {
      from() {
        return {
          where(condition) {
            return {
              async limit() {
                const row = [...state().rows.values()].find((item) => matches(condition, item));
                return row ? [project(selection, row)] : [];
              },
            };
          },
        };
      },
    };
  },
  delete() {
    return {
      async where(condition) {
        for (const [key, row] of state().rows) {
          if (matches(condition, row)) state().rows.delete(key);
        }
        return [];
      },
    };
  },
  insert() {
    return {
      values(values) {
        return {
          onConflictDoNothing() {
            return {
              async returning() {
                if (state().rows.has(values.cacheKey)) return [];
                state().rows.set(values.cacheKey, {
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  ...values,
                });
                return [{ createdAt: values.createdAt }];
              },
            };
          },
        };
      },
    };
  },
  update() {
    return {
      set(values) {
        return {
          where(condition) {
            return {
              async returning(selection) {
                const changed = [];
                for (const row of state().rows.values()) {
                  if (matches(condition, row)) {
                    Object.assign(row, values);
                    changed.push(project(selection, row));
                  }
                }
                return changed;
              },
              then(resolve, reject) {
                return this.returning({}).then(resolve, reject);
              },
            };
          },
        };
      },
    };
  },
};
`;

const ormMock = String.raw`
export const eq = (column, value) => ({ kind: "eq", column, value });
export const lte = (column, value) => ({ kind: "lte", column, value });
export const gt = (column, value) => ({ kind: "gt", column, value });
export const isNull = (column) => ({ kind: "isNull", column });
export const and = (...conditions) => ({ kind: "and", conditions });
`;

const expressMock = String.raw`
export function Router() {
  return {
    stack: [],
    get(path, ...handles) {
      this.stack.push({ route: { path, stack: handles.map((handle) => ({ handle })) } });
      return this;
    },
    post(path, ...handles) {
      this.stack.push({ route: { path, stack: handles.map((handle) => ({ handle })) } });
      return this;
    },
  };
}
`;

const rateLimitMock = String.raw`
export default function rateLimit() {
  return function rateLimitMiddleware(_req, _res, next) {
    if (next) next();
  };
}
`;

const openAiMock = String.raw`
export default class OpenAI {
  chat = {
    completions: {
      create: async () => {
        const state = globalThis.__aiRouteState;
        state.openAiCalls += 1;
        if (state.generate) return state.generate();
        if (state.generationError) throw state.generationError;
        return {
          choices: [{ message: { content: state.nextDescription } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      },
    },
  };
}
`;

const usageMock = String.raw`
export async function recordAiUsage() {}
`;

const profileMock = String.raw`
export async function getRestaurantProfile() {
  return null;
}
`;

async function loadRouter() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-route-"));
  const output = path.join(tempDir, "ai.mjs");
  const mocks = new Map([
    ["@workspace/db", dbMock],
    ["drizzle-orm", ormMock],
    ["express", expressMock],
    ["express-rate-limit", rateLimitMock],
    ["openai", openAiMock],
    ["ai-usage", usageMock],
    ["restaurant-profile", profileMock],
  ]);

  await build({
    entryPoints: [source],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    plugins: [{
      name: "ai-route-mocks",
      setup(pluginBuild) {
        pluginBuild.onResolve(
          { filter: /^@workspace\/db$|^drizzle-orm$|^express$|^express-rate-limit$|^openai$/ },
          (args) => ({ path: args.path, namespace: "ai-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /services\/aiUsage$/ },
          () => ({ path: "ai-usage", namespace: "ai-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /services\/restaurantProfileEngine$/ },
          () => ({ path: "restaurant-profile", namespace: "ai-mock" }),
        );
        pluginBuild.onLoad({ filter: /.*/, namespace: "ai-mock" }, (args) => ({
          contents: mocks.get(args.path),
          loader: "js",
        }));
      },
    }],
    logLevel: "silent",
  });

  const module = await import(pathToFileURL(output).href);
  return {
    router: module.default,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

const bundled = await loadRouter();
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
globalThis.setInterval = (callback) => {
  const timer = { callback, unref() {} };
  globalThis.__aiRouteState.timers.push(timer);
  return timer;
};
globalThis.clearInterval = (timer) => {
  const timers = globalThis.__aiRouteState.timers;
  timers.splice(timers.indexOf(timer), 1);
};

function resetState() {
  globalThis.__aiRouteState = {
    rows: new Map(),
    openAiCalls: 0,
    nextDescription: "Generated restaurant description.",
    generationError: null,
    generate: null,
    timers: [],
  };
  process.env.OPENAI_API_KEY = "test-key";
}

function handler(pathname) {
  const layer = bundled.router.stack.find((entry) => entry.route?.path === pathname);
  return layer.route.stack.at(-1).handle;
}

async function post(pathname, body) {
  let statusCode = 200;
  let payload;
  const res = {
    status(status) {
      statusCode = status;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
  };
  const log = { warn() {}, error() {} };
  await handler(pathname)({ body, log }, res);
  return { statusCode, payload };
}

const descriptionBody = {
  restaurantId: "place-1",
  name: "Example Restaurant",
  city: "London",
  cuisine: "Italian",
  rating: 4.5,
};

test("repeated and concurrent description requests share one paid generation", async () => {
  resetState();

  const [first, second] = await Promise.all([
    post("/describe", descriptionBody),
    post("/describe", descriptionBody),
  ]);
  const third = await post("/describe", descriptionBody);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(third.statusCode, 200);
  assert.equal(first.payload.description, "Generated restaurant description.");
  assert.deepEqual(second.payload, first.payload);
  assert.deepEqual(third.payload, first.payload);
  assert.equal(globalThis.__aiRouteState.openAiCalls, 1);
  assert.equal(globalThis.__aiRouteState.rows.size, 1);
});

test("expired descriptions regenerate while changed source details use a new key", async () => {
  resetState();
  await post("/describe", descriptionBody);
  const [cachedEntry] = globalThis.__aiRouteState.rows.values();
  cachedEntry.expiresAt = new Date(Date.now() - 1_000);

  await post("/describe", descriptionBody);
  await post("/describe", { ...descriptionBody, rating: 4.6 });

  assert.equal(globalThis.__aiRouteState.openAiCalls, 3);
  assert.equal(globalThis.__aiRouteState.rows.size, 2);
});

test("failed generations clear their reservation and are never cached as content", async () => {
  resetState();
  globalThis.__aiRouteState.generationError = new Error("provider failed");

  const failed = await post("/describe", descriptionBody);
  assert.equal(failed.statusCode, 502);
  assert.equal(globalThis.__aiRouteState.rows.size, 0);

  globalThis.__aiRouteState.generationError = null;
  const retried = await post("/describe", descriptionBody);
  assert.equal(retried.statusCode, 200);
  assert.equal(globalThis.__aiRouteState.openAiCalls, 2);
});

test("a slow generation renews its lease and keeps its own result", async () => {
  resetState();
  let complete;
  globalThis.__aiRouteState.generate = () => new Promise((resolve) => { complete = resolve; });
  const pending = post("/describe", descriptionBody);
  // Wait until insertion and the provider call have begun.
  while (!complete) await new Promise((resolve) => setImmediate(resolve));
  const [row] = globalThis.__aiRouteState.rows.values();
  // An active reservation nearing expiration is renewed by the timer.
  row.expiresAt = new Date(Date.now() + 1000);
  // Exercise the same timer callback without waiting 30 seconds.
  const timer = globalThis.__aiRouteState.timers.at(-1);
  await timer.callback();
  assert.ok(row.expiresAt.getTime() > Date.now() + 100_000);
  assert.ok(row.createdAt instanceof Date);
  complete({ choices: [{ message: { content: "Slow description" } }] });
  const result = await pending;
  assert.equal(result.statusCode, 200);
  assert.equal(row.description, "Slow description");
  assert.ok(row.createdAt instanceof Date);
});

test("a reclaimed reservation cannot overwrite or delete a replacement", async () => {
  resetState();
  let complete;
  globalThis.__aiRouteState.generate = () => new Promise((resolve) => { complete = resolve; });
  const pending = post("/describe", descriptionBody);
  while (!complete) await new Promise((resolve) => setImmediate(resolve));
  const state = globalThis.__aiRouteState;
  const [key, oldRow] = [...state.rows.entries()][0];
  const replacement = {
    ...oldRow,
    createdAt: new Date(oldRow.createdAt.getTime() + 120_001),
    description: null,
  };
  state.rows.set(key, replacement);
  complete({ choices: [{ message: { content: "Old result" } }] });
  const result = await pending;
  assert.equal(result.statusCode, 503);
  assert.equal(state.rows.get(key), replacement);
  assert.equal(replacement.description, null);
});

test("an expired hold is not renewed or published by its late generation", async () => {
  resetState();
  let complete;
  globalThis.__aiRouteState.generate = () => new Promise((resolve) => { complete = resolve; });
  const pending = post("/describe", descriptionBody);
  while (!complete) await new Promise((resolve) => setImmediate(resolve));
  const [row] = globalThis.__aiRouteState.rows.values();
  row.expiresAt = new Date(Date.now() - 1000);
  await globalThis.__aiRouteState.timers.at(-1).callback();
  assert.ok(row.expiresAt.getTime() < Date.now());
  complete({ choices: [{ message: { content: "Too late" } }] });
  const result = await pending;
  assert.equal(result.statusCode, 503);
  assert.equal(row.description, null);
});

test("owner marketing generation is not exposed on the public AI router", () => {
  assert.equal(
    bundled.router.stack.some((entry) =>
      ["/seo", "/social"].includes(entry.route?.path),
    ),
    false,
  );
});

test.after(async () => {
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
  await bundled.cleanup();
});