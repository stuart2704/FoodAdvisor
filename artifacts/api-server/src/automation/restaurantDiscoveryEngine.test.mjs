import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, beforeEach, test } from "node:test";
import { build } from "esbuild";

const directory = await mkdtemp(path.join(os.tmpdir(), "discovery-engine-"));
const outfile = path.join(directory, "discovery.mjs");
const mocks = {
  "@workspace/db": `
    export const restaurantsTable = { placeId: "placeId" };
    export const engineHeartbeatsTable = { engine: "engine" };
    export const db = {
      insert(table) {
        if (table === engineHeartbeatsTable) return {
          values(value) {
            return {
              async onConflictDoUpdate() {
                const state = globalThis.__discoveryState;
                state.events.push("heartbeat:" + value.engine);
                if (state.heartbeatError) throw state.heartbeatError;
              },
            };
          },
        };
        return {
          values(value) {
            const state = globalThis.__discoveryState;
            state.events.push("insert:" + value.placeId);
            if (state.insertError) throw state.insertError;
            return {
              onConflictDoNothing({ target }) {
                if (target !== restaurantsTable.placeId) throw new Error("Wrong conflict target");
                return {
                  async returning() {
                    if (state.places.has(value.placeId)) return [];
                    state.places.add(value.placeId);
                    return [{ ...value }];
                  },
                };
              },
            };
          },
        };
      },
    };
  `,
  "../lib/logger": `export const logger = { info() {}, error() {} };`,
  "../utils/eventLog": `export function logEvent() {} `,
  "./validator": `
    export function parseRestaurant(value) {
      globalThis.__discoveryState.events.push("validate:" + value.placeId);
      return value;
    }
  `,
  "../services/regionMap": `export function getRegionForCity() { return null; }`,
  "../utils/slugify": `
    export function restaurantSlug(name, placeId) { return name + "-" + placeId; }
  `,
  "../services/replyClassifier/classifyReply": `
    export function classifyReply() { throw new Error("Reply classification is not part of discovery"); }
  `,
  "../core/integration": `
    export async function runDailyCycle(options) {
      const state = globalThis.__discoveryState;
      state.events.push("daily-cycle");
      state.cycleOptions.push(options);
      if (state.cycleError) throw state.cycleError;
      return state.cycleResult;
    }
  `,
};

await build({
  entryPoints: [path.join(import.meta.dirname, "restaurantDiscoveryEngine.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "discovery-offline-boundaries",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (Object.hasOwn(mocks, args.path)) {
          return { path: args.path, namespace: "discovery-test" };
        }
      });
      builder.onLoad({ filter: /.*/, namespace: "discovery-test" }, (args) => ({
        contents: mocks[args.path],
        loader: "js",
      }));
    },
  }],
});
const { restaurantDiscoveryEngine } = await import(pathToFileURL(outfile).href);

const completedCycle = () => ({
  status: "completed",
  outreach: { status: "completed", result: { failed: 0 } },
  followups: { status: "completed", results: [] },
});
const restaurant = (placeId) => ({ placeId, name: "Example", city: "London" });
let state;

beforeEach(() => {
  state = {
    events: [],
    places: new Set(),
    cycleOptions: [],
    cycleResult: completedCycle(),
  };
  globalThis.__discoveryState = state;
});

after(async () => {
  delete globalThis.__discoveryState;
  await rm(directory, { recursive: true, force: true });
});

test("persists through canonical insertion, skips duplicates, and runs outreach once before heartbeat", async () => {
  const source = [restaurant("a"), restaurant("a"), restaurant("b")];
  const result = await restaurantDiscoveryEngine({
    fetchNewRestaurants: async () => {
      state.events.push("source");
      return source;
    },
    enrichRestaurants: async (rows) => {
      assert.equal(rows, source);
      state.events.push("enrich");
      return rows;
    },
  });
  assert.deepEqual(result, { fetched: 3, enriched: 3, inserted: 2 });
  assert.deepEqual(state.events, [
    "source", "enrich",
    "validate:a", "insert:a",
    "validate:a", "insert:a",
    "validate:b", "insert:b",
    "daily-cycle", "heartbeat:discovery",
  ]);
  assert.deepEqual(state.cycleOptions, [{ sendOutreach: true, sendFollowups: true }]);
  assert.deepEqual([...state.places], ["a", "b"]);
});

for (const [stage, options, expectedEvents] of [
  ["source", () => ({
    fetchNewRestaurants: async () => { throw new Error("source failed"); },
  }), []],
  ["enrichment", () => ({
    fetchNewRestaurants: async () => [restaurant("a")],
    enrichRestaurants: async () => { throw new Error("enrichment failed"); },
  }), []],
  ["persistence", () => ({
    fetchNewRestaurants: async () => [restaurant("a")],
  }), ["validate:a", "insert:a"]],
  ["automation", () => ({
    fetchNewRestaurants: async () => [restaurant("a")],
  }), ["validate:a", "insert:a", "daily-cycle"]],
]) {
  test(`${stage} failure propagates without a success heartbeat`, async () => {
    if (stage === "persistence") state.insertError = new Error("database unavailable");
    if (stage === "automation") state.cycleError = new Error("provider unavailable");
    await assert.rejects(
      restaurantDiscoveryEngine(options()),
      {
        message: {
          source: "source failed",
          enrichment: "enrichment failed",
          persistence: "Restaurant insertion failed; retry is required.",
          automation: "provider unavailable",
        }[stage],
      },
    );
    assert.deepEqual(state.events, expectedEvents);
    assert.deepEqual(state.cycleOptions, stage === "automation"
      ? [{ sendOutreach: true, sendFollowups: true }] : []);
  });
}

test("non-array source and enrichment results fail before outreach or heartbeat", async () => {
  await assert.rejects(
    restaurantDiscoveryEngine({ fetchNewRestaurants: async () => null }),
    /source must return an array/,
  );
  await assert.rejects(
    restaurantDiscoveryEngine({
      fetchNewRestaurants: async () => [restaurant("a")],
      enrichRestaurants: async () => null,
    }),
    /enrichment step must return an array/,
  );
  assert.deepEqual(state.events, []);
});

for (const [description, cycle] of [
  ["cycle status is failed", { ...completedCycle(), status: "failed" }],
  ["outreach has failed sends", {
    ...completedCycle(), outreach: { status: "completed", result: { failed: 1 } },
  }],
  ["followups have failed sends", {
    ...completedCycle(),
    followups: { status: "completed", results: [{ failed: 1 }] },
  }],
]) {
  test(`${description} does not record a discovery heartbeat`, async () => {
    state.cycleResult = cycle;
    await assert.rejects(
      restaurantDiscoveryEngine({ fetchNewRestaurants: async () => [restaurant("a")] }),
      /automation cycle reported failures/,
    );
    assert.deepEqual(state.events, ["validate:a", "insert:a", "daily-cycle"]);
    assert.equal(state.cycleOptions.length, 1);
  });
}

test("heartbeat write failure propagates rather than reporting success", async () => {
  state.heartbeatError = new Error("heartbeat unavailable");
  await assert.rejects(
    restaurantDiscoveryEngine({ fetchNewRestaurants: async () => [restaurant("a")] }),
    /heartbeat unavailable/,
  );
  assert.deepEqual(state.events, ["validate:a", "insert:a", "daily-cycle", "heartbeat:discovery"]);
});