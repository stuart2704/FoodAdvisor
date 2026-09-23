import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const apiRoot = path.resolve(import.meta.dirname, "../..");
const source = path.join(apiRoot, "src/routes/replies.ts");
const automationToken = "test-automation-token-with-at-least-32-bytes";

const expressMock = String.raw`
export function Router() {
  return {
    stack: [],
    post(path, handle) {
      this.stack.push({ route: { path, stack: [{ handle }] } });
      return this;
    },
  };
}
`;

const zodMock = String.raw`
export const ClassifyIncomingReplyBody = { safeParse: () => ({ success: false }) };
export const ClassifyIncomingReplyResponse = { parse: (value) => value };
export const PollInstantlyRepliesResponse = { parse: (value) => value };
export const PollGmailRepliesResponse = {
  parse(value) {
    globalThis.__gmailRouteState.parsed = value;
    return value;
  },
};
`;

const classifierMock = String.raw`
export async function processIncomingReply() {
  throw new Error("not used");
}
`;

const instantlyMock = String.raw`
export async function pollInstantlyReplies() {
  throw new Error("not used");
}
`;

const gmailMock = String.raw`
export async function pollGmailReplies() {
  const state = globalThis.__gmailRouteState;
  state.calls += 1;
  if (state.failure) throw state.failure;
  return state.result;
}
`;

async function loadRouter() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-replies-route-"));
  const output = path.join(tempDir, "replies.mjs");
  const mockSources = new Map([
    ["express", expressMock],
    ["@workspace/api-zod", zodMock],
    ["classifier", classifierMock],
    ["instantly", instantlyMock],
    ["gmail", gmailMock],
  ]);

  await build({
    entryPoints: [source],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    plugins: [{
      name: "gmail-replies-route-mocks",
      setup(pluginBuild) {
        pluginBuild.onResolve(
          { filter: /^express$|^@workspace\/api-zod$/ },
          (args) => ({ path: args.path, namespace: "route-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /replyClassifier\/processIncomingReply$/ },
          () => ({ path: "classifier", namespace: "route-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /services\/instantly\/instantlyService$/ },
          () => ({ path: "instantly", namespace: "route-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /services\/gmail\/gmailWebhookHandler$/ },
          () => ({ path: "gmail", namespace: "route-mock" }),
        );
        pluginBuild.onLoad({ filter: /.*/, namespace: "route-mock" }, (args) => ({
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

function gmailHandler() {
  const layer = bundled.router.stack.find(
    (entry) => entry.route?.path === "/automation/gmail/replies",
  );
  return layer.route.stack[0].handle;
}

async function postGmail({ token, body } = {}) {
  let statusCode = 200;
  let payload;
  const warnings = [];
  const req = {
    body,
    header(name) {
      return name === "authorization" && token ? `Bearer ${token}` : undefined;
    },
    log: {
      warn(message) {
        warnings.push(message);
      },
    },
  };
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
  await gmailHandler()(req, res);
  return { statusCode, payload, warnings };
}

function setState(overrides = {}) {
  globalThis.__gmailRouteState = {
    calls: 0,
    failure: null,
    parsed: null,
    result: {
      searchedThreads: 3,
      matchedThreads: 2,
      processed: 1,
      skipped: 1,
      failed: 0,
      capped: false,
      errors: [],
    },
    ...overrides,
  };
}

test("Gmail reply polling requires the shared automation bearer token", async () => {
  process.env.AUTOMATION_TOKEN = automationToken;
  setState();

  const response = await postGmail();

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.payload, { error: "Invalid automation credential." });
  assert.equal(globalThis.__gmailRouteState.calls, 0);
});

test("Gmail reply polling uses only server-derived inputs", async () => {
  process.env.AUTOMATION_TOKEN = automationToken;
  setState();

  const response = await postGmail({
    token: automationToken,
    body: { placeId: "caller-selected", body: "caller-selected" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, globalThis.__gmailRouteState.result);
  assert.equal(globalThis.__gmailRouteState.calls, 1);
  assert.equal(globalThis.__gmailRouteState.parsed, globalThis.__gmailRouteState.result);
});

test("Gmail reply polling sanitizes temporary failures", async () => {
  process.env.AUTOMATION_TOKEN = automationToken;
  setState({ failure: new Error("secret provider and database details") });

  const response = await postGmail({ token: automationToken });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.payload, {
    error: "Gmail reply polling is temporarily unavailable.",
  });
  assert.deepEqual(response.warnings, ["Gmail reply polling did not run"]);
  assert.doesNotMatch(JSON.stringify(response.payload), /secret|provider|database/i);
});

test.after(async () => {
  await bundled.cleanup();
});