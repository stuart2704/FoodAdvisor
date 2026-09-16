import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { issueClaimLink } from "../lib/claim-link.ts";

const apiRoot = path.resolve(import.meta.dirname, "../..");
const source = path.join(apiRoot, "src/routes/subscriptions.ts");
const secureSecret = "test-session-secret-with-at-least-thirty-two-bytes";

const dbMock = String.raw`
const table = (columns) => Object.fromEntries(
  columns.map((column) => [column, { column }]),
);
export const restaurantsTable = table(["placeId", "claimStatus", "claimAttemptId"]);
export const claimPageEventsTable = table(["placeId", "eventType", "alreadyClaimed"]);
export const analyticsEventsTable = table(["restaurantId", "type", "metadata"]);
const state = () => globalThis.__claimRouteState;
const value = (column, row) => row[column.column];
const matches = (condition, row) => {
  if (!condition) return true;
  if (condition.kind === "and") return condition.conditions.every((child) => matches(child, row));
  if (condition.kind === "eq") return value(condition.column, row) === condition.expected;
  if (condition.kind === "isNull") return value(condition.column, row) == null;
  return false;
};
const projection = (selection, row) => Object.fromEntries(
  Object.entries(selection).map(([key, column]) => [key, value(column, row)]),
);
const transaction = {
  select(selection) {
    return {
      from() {
        return {
          where(condition) {
            return {
              async limit() {
                const row = state().restaurant;
                return row && matches(condition, row) ? [projection(selection, row)] : [];
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
                const row = state().restaurant;
                if (!row || !matches(condition, row)) return [];
                Object.assign(row, values);
                state().updates += 1;
                return [projection(selection, row)];
              },
            };
          },
        };
      },
    };
  },
};
export const db = {
  insert() {
    return {
      async values() {
        return [];
      },
    };
  },
  async transaction(operation) {
    const current = state();
    const snapshot = structuredClone(current.restaurant);
    try {
      return await operation(transaction);
    } catch (error) {
      current.restaurant = snapshot;
      throw error;
    }
  },
};
`;

const ormMock = String.raw`
export const eq = (column, expected) => ({ kind: "eq", column, expected });
export const isNull = (column) => ({ kind: "isNull", column });
export const and = (...conditions) => ({ kind: "and", conditions });
`;

const zodMock = String.raw`
const validEmail = (value) => typeof value === "string" && value.includes("@");
export const ClaimRestaurantParams = {
  safeParse: (value) => typeof value?.placeId === "string" && value.placeId
    ? { success: true, data: { placeId: value.placeId } }
    : { success: false },
};
export const ClaimRestaurantBody = {
  safeParse: (value) => validEmail(value?.email) && typeof value?.claimToken === "string"
    ? { success: true, data: value }
    : { success: false },
};
export const ClaimRestaurantResponse = { parse: (value) => value };
`;

const lockMock = String.raw`
export async function withInstantlyRestaurantLock(_placeId, operation) {
  return operation();
}
`;

const cancellationMock = String.raw`
export async function enqueueAllInstantlyCancellationIntents() {
  globalThis.__claimRouteState.cancellations += 1;
  if (globalThis.__claimRouteState.failCancellation) {
    throw new Error("cancellation intent insert failed");
  }
}
`;

const onboardingMock = String.raw`
export async function startOnboarding(placeId) {
  return { placeId, portalToken: "test-portal-token" };
}
`;

const escalationMock = String.raw`
export async function escalateClaimClick() {
  return { escalationStatus: "WARM" };
}
`;

const expressMock = String.raw`
export function Router() {
  const router = {
    stack: [],
    get(path, handle) {
      this.stack.push({ route: { path, stack: [{ handle }] } });
      return this;
    },
    post(path, handle) {
      this.stack.push({ route: { path, stack: [{ handle }] } });
      return this;
    },
  };
  return router;
}
`;

async function loadRouter() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "claim-route-"));
  const output = path.join(tempDir, "subscriptions.mjs");
  const mockSources = new Map([
    ["@workspace/db", dbMock],
    ["drizzle-orm", ormMock],
    ["@workspace/api-zod", zodMock],
    ["instantly-service", lockMock],
    ["cancellation-intents", cancellationMock],
    ["onboarding-service", onboardingMock],
    ["escalation-service", escalationMock],
    ["express", expressMock],
  ]);
  await build({
    entryPoints: [source],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    plugins: [{
      name: "claim-route-mocks",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^@workspace\/(db|api-zod)$|^drizzle-orm$/ }, (args) => ({
          path: args.path,
          namespace: "claim-mock",
        }));
        pluginBuild.onResolve({ filter: /^express$/ }, () => ({
          path: "express",
          namespace: "claim-mock",
        }));
        pluginBuild.onResolve({ filter: /outreach\/instantlyService$/ }, () => ({
          path: "instantly-service",
          namespace: "claim-mock",
        }));
        pluginBuild.onResolve({ filter: /services\/instantly\/cancellationIntents$/ }, () => ({
          path: "cancellation-intents",
          namespace: "claim-mock",
        }));
        pluginBuild.onResolve({ filter: /services\/onboardingService$/ }, () => ({
          path: "onboarding-service",
          namespace: "claim-mock",
        }));
        pluginBuild.onResolve({ filter: /services\/leadEscalationService$/ }, () => ({
          path: "escalation-service",
          namespace: "claim-mock",
        }));
        pluginBuild.onLoad({ filter: /.*/, namespace: "claim-mock" }, (args) => ({
          contents: mockSources.get(args.path),
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

function handler() {
  const layer = bundled.router.stack.find((entry) =>
    entry.route?.path === "/restaurants/:placeId/claim");
  return layer.route.stack[0].handle;
}

async function postClaim(placeId, body) {
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
  await handler()({ params: { placeId }, body }, res);
  return { statusCode, payload };
}

function setState(restaurant, failCancellation = false) {
  globalThis.__claimRouteState = {
    restaurant,
    updates: 0,
    cancellations: 0,
    failCancellation,
  };
}

function issuedToken(placeId = "place-1") {
  process.env.SESSION_SECRET = secureSecret;
  return issueClaimLink(placeId);
}

test("claim route rejects a missing or invalid link without changing a listing", async () => {
  const token = issuedToken();
  const original = { placeId: "place-1", claimStatus: null, claimAttemptId: null };
  setState(structuredClone(original));

  assert.equal((await postClaim("place-1", { email: "owner@example.test" })).statusCode, 400);
  assert.equal((await postClaim("place-1", {
    email: "owner@example.test",
    claimToken: `${token}x`,
  })).statusCode, 403);
  assert.deepEqual(globalThis.__claimRouteState.restaurant, original);
  assert.equal(globalThis.__claimRouteState.updates, 0);
});

test("claim route records a valid first claim and never overwrites a replayed listing", async () => {
  const token = issuedToken();
  setState({
    placeId: "place-1",
    claimStatus: null,
    claimAttemptId: null,
  });

  const first = await postClaim("place-1", {
    email: "owner@example.test",
    claimToken: token,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.status, "basic");
  assert.deepEqual(globalThis.__claimRouteState.restaurant, {
    placeId: "place-1",
    claimStatus: "basic",
    claimAttemptId: null,
    claimEmail: "owner@example.test",
  });
  assert.equal(globalThis.__claimRouteState.updates, 1);
  assert.equal(globalThis.__claimRouteState.cancellations, 1);

  const second = await postClaim("place-1", {
    email: "owner@example.test",
    claimToken: token,
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.payload.status, "already_claimed");
  assert.equal(globalThis.__claimRouteState.updates, 1);
  assert.equal(globalThis.__claimRouteState.cancellations, 1);

  const verified = {
    placeId: "place-1",
    claimStatus: "active",
    claimAttemptId: "historic-pending-claim",
    claimEmail: "historic@example.test",
  };
  setState(structuredClone(verified));
  const existing = await postClaim("place-1", {
    email: "attacker@example.test",
    claimToken: token,
  });
  assert.equal(existing.statusCode, 200);
  assert.equal(existing.payload.status, "already_claimed");
  assert.deepEqual(globalThis.__claimRouteState.restaurant, verified);
  assert.equal(globalThis.__claimRouteState.updates, 0);
  assert.equal(globalThis.__claimRouteState.cancellations, 0);
});

test("claim route rolls back its claim when cancellation intent persistence fails", async () => {
  const token = issuedToken();
  const original = {
    placeId: "place-1",
    claimStatus: null,
    claimAttemptId: null,
  };
  setState(structuredClone(original), true);

  const result = await postClaim("place-1", {
    email: "owner@example.test",
    claimToken: token,
  });
  assert.equal(result.statusCode, 503);
  assert.deepEqual(globalThis.__claimRouteState.restaurant, original);
});

test.after(async () => {
  await bundled.cleanup();
});