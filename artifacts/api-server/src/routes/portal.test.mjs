import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const apiRoot = path.resolve(import.meta.dirname, "../..");
const source = path.join(apiRoot, "src/routes/portal.ts");

const dbMock = String.raw`
const column = (name) => ({ name });
export const restaurantsTable = new Proxy({}, {
  get(_target, name) { return column(name); },
});
const state = () => globalThis.__portalRouteState;
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
                const restaurant = state().restaurant;
                if (!restaurant || restaurant.placeId !== condition.value) return [];
                return [project(selection, restaurant)];
              },
            };
          },
        };
      },
    };
  },
};
`;

const expressMock = String.raw`
export function Router() {
  return {
    stack: [],
    get(path, ...handles) {
      this.stack.push({ route: { method: "get", path, stack: handles.map((handle) => ({ handle })) } });
      return this;
    },
    post(path, ...handles) {
      this.stack.push({ route: { method: "post", path, stack: handles.map((handle) => ({ handle })) } });
      return this;
    },
  };
}
`;

const aiMock = String.raw`
export const seoLimiter = (_req, _res, next) => next?.();
export const socialLimiter = (_req, _res, next) => next?.();
export async function generateSeoCopy(details) {
  globalThis.__portalRouteState.aiCalls.push({ kind: "seo", details });
  return "Generated SEO";
}
export async function generateSocialCopy(details) {
  globalThis.__portalRouteState.aiCalls.push({ kind: "social", details });
  return "Generated social posts";
}
`;

async function loadRouter() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "portal-route-"));
  const output = path.join(tempDir, "portal.mjs");
  const simpleMocks = new Map([
    ["analytics", "export async function logEvent(){}; export async function getRestaurantAnalytics(){ return {}; }"],
    ["insight", "export async function generateOwnerAnalyticsInsight(){ return {}; }"],
    ["personalisation", "export async function recordOwnerLogin(){}"],
    ["token", "export async function validateToken(token){ return token === 'v'.repeat(43) ? 'place-1' : null; }"],
  ]);

  await build({
    entryPoints: [source],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    plugins: [{
      name: "portal-route-mocks",
      setup(pluginBuild) {
        pluginBuild.onResolve(
          { filter: /^@workspace\/db$|^drizzle-orm$|^express$|\.\/ai$/ },
          (args) => ({ path: args.path, namespace: "portal-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /analyticsEngine$/ },
          () => ({ path: "analytics", namespace: "portal-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /ownerAnalyticsInsight$/ },
          () => ({ path: "insight", namespace: "portal-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /personalisationEngine$/ },
          () => ({ path: "personalisation", namespace: "portal-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /portalTokenService$/ },
          () => ({ path: "token", namespace: "portal-mock" }),
        );
        pluginBuild.onLoad({ filter: /.*/, namespace: "portal-mock" }, (args) => ({
          contents:
            args.path === "@workspace/db"
              ? dbMock
              : args.path === "drizzle-orm"
                ? "export const eq = (column, value) => ({ column, value });"
                : args.path === "express"
                  ? expressMock
                  : args.path === "./ai"
                    ? aiMock
                    : simpleMocks.get(args.path),
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
const validToken = "v".repeat(43);

function resetState(claimStatus = "basic") {
  globalThis.__portalRouteState = {
    restaurant: {
      placeId: "place-1",
      name: "Authoritative Bistro",
      city: "Bristol",
      cuisineTags: ["French"],
      types: ["restaurant"],
      rating: 4.6,
      claimStatus,
    },
    aiCalls: [],
  };
  process.env.OPENAI_API_KEY = "test-key";
}

function route(pathname) {
  return bundled.router.stack.find((entry) => entry.route?.path === pathname).route;
}

async function post(pathname, { token = validToken, body = {} } = {}) {
  let statusCode = 200;
  let payload;
  const res = {
    setHeader() {},
    status(status) {
      statusCode = status;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
  };
  const handlers = route(pathname).stack.map(({ handle }) => handle);
  await handlers.at(-1)({
    params: { token },
    body,
    log: { warn() {}, error() {} },
  }, res);
  return { statusCode, payload };
}

test("claimed owner SEO uses only the token-linked database listing", async () => {
  resetState();
  const result = await post("/portal/:token/marketing/seo", {
    body: {
      name: "Someone Else",
      city: "Wrong City",
      cuisine: "Wrong Cuisine",
      rating: 1,
    },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.seo, "Generated SEO");
  assert.deepEqual(globalThis.__portalRouteState.aiCalls, [{
    kind: "seo",
    details: {
      name: "Authoritative Bistro",
      city: "Bristol",
      cuisine: "French",
      rating: 4.6,
    },
  }]);
});

test("claimed owner social generation accepts tone but not restaurant identity", async () => {
  resetState();
  const result = await post("/portal/:token/marketing/social", {
    body: { tone: "professional" },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(globalThis.__portalRouteState.aiCalls[0], {
    kind: "social",
    details: {
      name: "Authoritative Bistro",
      city: "Bristol",
      cuisine: "French",
      rating: 4.6,
      tone: "professional",
    },
  });
});

test("invalid tokens and unclaimed listings never invoke generation", async () => {
  resetState();
  const invalid = await post("/portal/:token/marketing/seo", { token: "x".repeat(43) });
  assert.equal(invalid.statusCode, 404);
  assert.equal(globalThis.__portalRouteState.aiCalls.length, 0);

  resetState(null);
  const unclaimed = await post("/portal/:token/marketing/seo");
  assert.equal(unclaimed.statusCode, 404);
  assert.equal(globalThis.__portalRouteState.aiCalls.length, 0);
});

test.after(async () => {
  await bundled.cleanup();
});