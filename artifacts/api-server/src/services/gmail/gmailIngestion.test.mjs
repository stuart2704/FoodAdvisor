import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const serviceDir = import.meta.dirname;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-ingestion-"));

const tablesAndDbMock = String.raw`
const table = (name, columns) => Object.assign({ __table: name },
  Object.fromEntries(columns.map((name) => [name, { __table: name, __column: name }])));
export const gmailOutreachThreadsTable = table("threads", ["threadId", "sentMessageId", "placeId"]);
export const processedGmailMessagesTable = table("processed", ["messageId", "threadId", "placeId"]);
export const gmailHistoryMessagesTable = table("history", [
  "messageId", "threadId", "accountEmail", "status", "nextAttemptAt", "attempts",
  "updatedAt", "tombstonedAt",
]);
export const restaurantsTable = table("restaurants", [
  "placeId", "outreachStatus", "suppressedAt", "suppressionReason", "publicBusinessEmail",
]);
export const outreachAuditTable = table("audit", ["placeId", "event", "recipientDomain", "detail"]);
export const processedInstantlyMessagesTable = table("instantly", ["messageId"]);
export const processedInstantlyFollowupMessagesTable = table("instantlyFollowup", ["messageId"]);

const state = () => globalThis.__gmailDbState;
const rows = (table) => state()[table.__table] ?? [];
const value = (column, row) => row[column.__column];
export const eq = (column, expected) => ({ kind: "eq", column, expected });
export const inArray = (column, expected) => ({ kind: "in", column, expected });
export const and = (...conditions) => ({ kind: "and", conditions });
export const or = (...conditions) => ({ kind: "or", conditions });
export const isNull = (column) => ({ kind: "null", column });
export const lte = (column, expected) => ({ kind: "lte", column, expected });
export function sql(strings, ...values) { return { kind: "sql", strings, values }; }
const matches = (condition, row) => {
  if (!condition) return true;
  if (condition.kind === "eq") return value(condition.column, row) === condition.expected;
  if (condition.kind === "in") return condition.expected.includes(value(condition.column, row));
  if (condition.kind === "and") return condition.conditions.every((item) => matches(item, row));
  if (condition.kind === "or") return condition.conditions.some((item) => matches(item, row));
  if (condition.kind === "null") return value(condition.column, row) == null;
  if (condition.kind === "lte") return value(condition.column, row) <= condition.expected;
  return true;
};
const project = (selection, row) => selection
  ? Object.fromEntries(Object.entries(selection).map(([key, column]) => [key, value(column, row)]))
  : { ...row };
class Select {
  constructor(selection) { this.selection = selection; this.condition = null; this.maximum = Infinity; }
  from(table) { this.table = table; return this; }
  where(condition) { this.condition = condition; return this; }
  limit(maximum) { this.maximum = maximum; return this; }
  async run() {
    return rows(this.table).filter((row) => matches(this.condition, row))
      .slice(0, this.maximum).map((row) => project(this.selection, row));
  }
  then(resolve, reject) { return this.run().then(resolve, reject); }
}
class Update {
  constructor(table) { this.table = table; this.patch = {}; this.condition = null; }
  set(patch) { this.patch = patch; return this; }
  where(condition) { this.condition = condition; return this; }
  returning(selection) { this.selection = selection; return this.run(); }
  async run() {
    const changed = [];
    for (const row of rows(this.table)) {
      if (!matches(this.condition, row)) continue;
      Object.assign(row, this.patch);
      changed.push(project(this.selection, row));
    }
    return changed;
  }
  then(resolve, reject) { return this.run().then(resolve, reject); }
}
class Insert {
  constructor(table) { this.table = table; }
  values(input) { this.input = input; return this; }
  onConflictDoNothing() { this.ignore = true; return this; }
  returning(selection) {
    const target = rows(this.table);
    const duplicate = this.table === processedGmailMessagesTable &&
      target.some((row) => row.messageId === this.input.messageId);
    if (!duplicate) target.push({ ...this.input });
    return Promise.resolve(duplicate ? [] : [project(selection, this.input)]);
  }
  then(resolve, reject) {
    rows(this.table).push({ ...this.input });
    return Promise.resolve().then(resolve, reject);
  }
}
export const db = {
  select(selection) { return new Select(selection); },
  update(table) { return new Update(table); },
  insert(table) { return new Insert(table); },
  async execute() {},
  async transaction(callback) {
    const current = state();
    const snapshot = structuredClone(current);
    try {
      return await callback(this);
    } catch (error) {
      for (const key of Object.keys(current)) delete current[key];
      Object.assign(current, snapshot);
      throw error;
    }
  },
};
export const pool = {};
`;

const ormMock = `export { and, eq, inArray, isNull, lte, or, sql } from "@workspace/db";`;
const gmailClientMock = String.raw`
export class GmailHttpError extends Error { constructor(status) { super("Gmail HTTP error"); this.status = status; } }
const api = () => globalThis.__gmailApi;
export const searchInboxThreads = (...args) => api().searchInboxThreads(...args);
export const listThreadMessages = (...args) => api().listThreadMessages(...args);
export const getMessageSummary = (...args) => api().getMessageSummary(...args);
export const getFullMessage = (...args) => api().getFullMessage(...args);
export const getHeader = (message, name) => message.payload?.headers?.find(
  (header) => header.name?.toLowerCase() === name.toLowerCase())?.value;
export function decodeBoundedPlainText(message) {
  const body = message.body ?? "";
  if (Buffer.byteLength(body, "utf8") > 10000) throw new Error("Gmail reply body exceeded the size limit.");
  return body.trim() || null;
}
`;
const classifierMock = String.raw`
export async function processGmailIncomingReply(input) {
  globalThis.__gmailProcessCalls.push(input);
  if (globalThis.__gmailProcessError) throw globalThis.__gmailProcessError;
  return globalThis.__gmailProcessResult ??
    { status: "processed", classification: { category: "interested", confidence: 1 } };
}
`;
const contractsMock = String.raw`
export const isPermanentGmailMessageStatus = () => false;
export const summaryFetchFailureTransition = () => ({ status: "pending", nextAttemptAt: new Date(), tombstonedAt: null });
`;

async function bundle(entryPoint, outfile, mocks) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "gmail-test-mocks",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          const key = mocks.find(([match]) => match(args.path, args.importer))?.[1];
          return key ? { path: key, namespace: "gmail-test" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "gmail-test" }, (args) => ({
          contents: mocks.find(([, key]) => key === args.path)[2],
          loader: "js",
        }));
      },
    }],
  });
}

const handlerOutput = path.join(tempDir, "handler.mjs");
await bundle(path.join(serviceDir, "gmailWebhookHandler.ts"), handlerOutput, [
  [value => value === "@workspace/db", "db", tablesAndDbMock],
  [value => value === "drizzle-orm", "orm", ormMock],
  [value => value.endsWith("/gmailClient") || value === "./gmailClient", "client", gmailClientMock],
  [value => value.includes("replyClassifier/processIncomingReply"), "classifier", classifierMock],
  [value => value.endsWith("/gmailContracts") || value === "./gmailContracts", "contracts", contractsMock],
]);
const handler = await import(pathToFileURL(handlerOutput).href);

function message(id, threadId, labelIds = ["INBOX"], body = `Reply ${id}`) {
  return { id, threadId, labelIds, body, payload: { headers: [{ name: "From", value: "Owner <owner@example.test>" }] } };
}
function resetHandler({ threads = [], processed = [] } = {}) {
  globalThis.__gmailDbState = {
    threads: structuredClone(threads), processed: structuredClone(processed),
    history: [], restaurants: [], audit: [],
  };
  globalThis.__gmailProcessCalls = [];
  globalThis.__gmailProcessResult = undefined;
  globalThis.__gmailProcessError = undefined;
  const summaries = new Map();
  const full = new Map();
  globalThis.__gmailApi = {
    searchInboxThreads: async () => [],
    listThreadMessages: async (threadId) => [...summaries.values()].filter((item) => item.threadId === threadId),
    getMessageSummary: async (id) => summaries.get(id) ?? message(id, "unknown"),
    getFullMessage: async (id) => full.get(id) ?? summaries.get(id) ?? message(id, "unknown"),
    summaries,
    full,
  };
}

test("poll reads only stored Gmail threads and maps replies to that restaurant", async () => {
  resetHandler({ threads: [{ threadId: "known", sentMessageId: "sent", placeId: "restaurant-a" }] });
  globalThis.__gmailApi.searchInboxThreads = async () => ["unknown", "known", "known"];
  globalThis.__gmailApi.summaries.set("sent", message("sent", "known", ["SENT"]));
  globalThis.__gmailApi.summaries.set("reply", message("reply", "known"));
  globalThis.__gmailApi.full.set("reply", message("reply", "known"));
  const result = await handler.pollGmailReplies();
  assert.equal(result.searchedThreads, 2);
  assert.equal(result.matchedThreads, 1);
  assert.equal(result.processed, 1);
  assert.deepEqual(globalThis.__gmailProcessCalls.map(({ placeId, gmailThreadId }) =>
    ({ placeId, gmailThreadId })), [{ placeId: "restaurant-a", gmailThreadId: "known" }]);
});

test("process IDs excludes unknown mappings, original, SENT, and DRAFT messages", async () => {
  resetHandler({ threads: [{ threadId: "known", sentMessageId: "original", placeId: "restaurant-a" }] });
  for (const item of [
    message("unknown", "not-mapped"),
    message("original", "known"),
    message("sent-copy", "known", ["SENT"]),
    message("draft", "known", ["DRAFT"]),
  ]) globalThis.__gmailApi.summaries.set(item.id, item);
  const result = await handler.processGmailMessageIds(["unknown", "original", "sent-copy", "draft"]);
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 4);
  assert.equal(globalThis.__gmailProcessCalls.length, 0);
});

test("process IDs rejects summary/full identity or thread mismatches", async () => {
  resetHandler({ threads: [{ threadId: "known", sentMessageId: "original", placeId: "restaurant-a" }] });
  globalThis.__gmailApi.summaries.set("summary-wrong-id", message("different-id", "known"));
  globalThis.__gmailApi.summaries.set("full-wrong-id", message("full-wrong-id", "known"));
  globalThis.__gmailApi.full.set("full-wrong-id", message("different-full-id", "known"));
  globalThis.__gmailApi.summaries.set("full-wrong-thread", message("full-wrong-thread", "known"));
  globalThis.__gmailApi.full.set("full-wrong-thread", message("full-wrong-thread", "other"));
  const result = await handler.processGmailMessageIds([
    "summary-wrong-id", "full-wrong-id", "full-wrong-thread",
  ]);
  assert.equal(result.processed, 0);
  assert.equal(globalThis.__gmailProcessCalls.length, 0);
});

test("process IDs bounds decoded bodies, de-duplicates IDs, and attempts at most 20", async () => {
  resetHandler({ threads: [{ threadId: "known", sentMessageId: "original", placeId: "restaurant-a" }] });
  const ids = ["oversized", ...Array.from({ length: 22 }, (_, index) => `reply-${index}`)];
  for (const id of ids) {
    const item = message(id, "known", ["INBOX"], id === "oversized" ? "é".repeat(5001) : `Body ${id}`);
    globalThis.__gmailApi.summaries.set(id, item);
    globalThis.__gmailApi.full.set(id, item);
  }
  const result = await handler.processGmailMessageIds(["oversized", "oversized", ...ids.slice(1)]);
  assert.equal(result.capped, true);
  assert.equal(globalThis.__gmailProcessCalls.length, 19);
  assert.equal(result.failed, 1);
  assert.equal(new Set(globalThis.__gmailProcessCalls.map(item => item.gmailMessageId)).size, 19);
  assert.ok(globalThis.__gmailProcessCalls.every(item => Buffer.byteLength(item.body, "utf8") <= 10000));
});

test("staged drain treats a transactional duplicate as skipped and completes the row", async () => {
  resetHandler({ threads: [{ threadId: "known", sentMessageId: "original", placeId: "restaurant-a" }] });
  globalThis.__gmailDbState.history.push({
    messageId: "reply", threadId: "known", accountEmail: "inbox@example.test",
    status: "pending", attempts: 0, nextAttemptAt: null,
  });
  const item = message("reply", "known");
  globalThis.__gmailApi.summaries.set("reply", item);
  globalThis.__gmailApi.full.set("reply", item);
  globalThis.__gmailProcessResult = { status: "duplicate" };
  const result = await handler.drainStagedGmailMessages("inbox@example.test");
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(globalThis.__gmailDbState.history[0].status, "processed");
  assert.equal(globalThis.__gmailDbState.history[0].attempts, 1);
});

test("staged drain leaves transient classifier failures pending for retry", async () => {
  resetHandler({ threads: [{ threadId: "known", sentMessageId: "original", placeId: "restaurant-a" }] });
  globalThis.__gmailDbState.history.push({
    messageId: "reply", threadId: "known", accountEmail: "inbox@example.test",
    status: "pending", attempts: 0, nextAttemptAt: null,
  });
  const item = message("reply", "known");
  globalThis.__gmailApi.summaries.set("reply", item);
  globalThis.__gmailApi.full.set("reply", item);
  globalThis.__gmailProcessError = new Error("temporary database outage");
  const before = Date.now();
  const result = await handler.drainStagedGmailMessages("inbox@example.test");
  const row = globalThis.__gmailDbState.history[0];
  assert.equal(result.failed, 1);
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
  assert.ok(row.nextAttemptAt instanceof Date);
  assert.ok(row.nextAttemptAt.getTime() >= before + 29_000);
  assert.equal(result.capped, true);
});

const processOutput = path.join(tempDir, "process.mjs");
const noOpLogMock = `export function logEvent() { globalThis.__gmailServiceCalls.logs += 1; }`;
const cancellationMock = `export async function enqueueAllInstantlyCancellationIntents() { globalThis.__gmailServiceCalls.cancellations += 1; }`;
const escalationMock = `export async function escalatePositiveReply() { globalThis.__gmailServiceCalls.escalations += 1; }
export async function sendPositiveReply() { globalThis.__gmailServiceCalls.sends += 1; }`;
await bundle(
  path.resolve(serviceDir, "../replyClassifier/processIncomingReply.ts"),
  processOutput,
  [
    [value => value === "@workspace/db", "db", tablesAndDbMock],
    [value => value === "drizzle-orm", "orm", ormMock],
    [value => value.includes("utils/eventLog"), "log", noOpLogMock],
    [value => value.includes("instantly/cancellationIntents"), "cancel", cancellationMock],
    [value => value.includes("leadEscalationService"), "escalate", escalationMock],
  ],
);
const processor = await import(pathToFileURL(processOutput).href);

function resetProcessor({ restaurant = true, mapping = true } = {}) {
  globalThis.__gmailDbState = {
    threads: mapping ? [{ threadId: "thread-a", sentMessageId: "original", placeId: "place-a" }] : [],
    processed: [],
    restaurants: restaurant ? [{
      placeId: "place-a", outreachStatus: "sent", publicBusinessEmail: "owner@example.test",
    }] : [],
    audit: [], history: [], instantly: [], instantlyFollowup: [],
  };
  globalThis.__gmailServiceCalls = { logs: 0, cancellations: 0, escalations: 0, sends: 0 };
}
const positive = {
  placeId: "place-a", body: "Yes, I am interested. Please tell me more.",
  from: "Owner <owner@example.test>", gmailMessageId: "reply-a", gmailThreadId: "thread-a",
};

test("Gmail processing reserves idempotency durably in the reply transaction", async () => {
  resetProcessor();
  const first = await processor.processGmailIncomingReply(positive);
  const second = await processor.processGmailIncomingReply(positive);
  assert.equal(first.status, "processed");
  assert.equal(second.status, "duplicate");
  assert.deepEqual(globalThis.__gmailDbState.processed.map(row => row.messageId), ["reply-a"]);
  assert.equal(globalThis.__gmailDbState.audit.length, 1);
});

test("Gmail processing rolls back its reservation when the restaurant is missing", async () => {
  resetProcessor({ restaurant: false });
  await assert.rejects(() => processor.processGmailIncomingReply(positive), /restaurant was not found/i);
  assert.deepEqual(globalThis.__gmailDbState.processed, []);
  assert.deepEqual(globalThis.__gmailDbState.audit, []);
});

test("positive Gmail replies never escalate or send email", async () => {
  resetProcessor();
  const result = await processor.processGmailIncomingReply(positive);
  assert.equal(result.status, "processed");
  assert.equal(result.classification.category, "interested");
  assert.equal(globalThis.__gmailServiceCalls.escalations, 0);
  assert.equal(globalThis.__gmailServiceCalls.sends, 0);
});

test("Gmail processing rejects mismatched thread/place mappings and original IDs", async () => {
  for (const input of [
    { ...positive, placeId: "other-place" },
    { ...positive, gmailThreadId: "other-thread" },
    { ...positive, gmailMessageId: "original" },
  ]) {
    resetProcessor();
    await assert.rejects(() => processor.processGmailIncomingReply(input), /ownership could not be verified/i);
    assert.deepEqual(globalThis.__gmailDbState.processed, []);
    assert.deepEqual(globalThis.__gmailDbState.audit, []);
  }
});

test("Gmail processing enforces a 10,000-byte body limit before writes", async () => {
  resetProcessor();
  await assert.rejects(() => processor.processGmailIncomingReply({
    ...positive, body: "é".repeat(5001),
  }), /size limit/i);
  assert.deepEqual(globalThis.__gmailDbState.processed, []);
});

const connectorMock = String.raw`
export class ReplitConnectors {
  async proxy(service, path, options) {
    globalThis.__gmailConnectorCalls.push({ service, path, options });
    const value = await globalThis.__gmailConnectorResponse(path);
    return { ok: true, status: 200, async json() { return value; } };
  }
}
`;
const clientOutput = path.join(tempDir, "client.mjs");
await bundle(path.join(serviceDir, "gmailClient.ts"), clientOutput, [
  [value => value === "@replit/connectors-sdk", "connector", connectorMock],
]);
const client = await import(pathToFileURL(clientOutput).href);

test("Gmail ingestion client reads use connector GET requests only", async () => {
  globalThis.__gmailConnectorCalls = [];
  globalThis.__gmailConnectorResponse = async (requestPath) => {
    if (requestPath.includes("/threads?")) return { threads: [{ id: "thread-a" }] };
    if (requestPath.includes("/threads/thread-a")) {
      return { messages: [{ id: "message-a", threadId: "thread-a", labelIds: ["INBOX"] }] };
    }
    return { id: "message-a", threadId: "thread-a", labelIds: ["INBOX"] };
  };
  await client.searchInboxThreads();
  await client.listThreadMessages("thread-a");
  await client.getMessageSummary("message-a");
  await client.getFullMessage("message-a");
  assert.equal(globalThis.__gmailConnectorCalls.length, 4);
  assert.ok(globalThis.__gmailConnectorCalls.every(call =>
    call.service === "google-mail" &&
    call.options.method === "GET" &&
    call.options.body === undefined));
});

test("plain-text MIME decoding enforces byte, node, and depth limits", () => {
  const encoded = value => Buffer.from(value).toString("base64url");
  assert.equal(client.decodeBoundedPlainText({
    id: "m", threadId: "t", labelIds: [],
    payload: { mimeType: "text/plain", body: { data: encoded("hello"), size: 5 } },
  }), "hello");
  assert.throws(() => client.decodeBoundedPlainText({
    id: "m", threadId: "t", labelIds: [],
    payload: { mimeType: "text/plain", body: { data: encoded("é".repeat(5001)) } },
  }), /size limit/i);
  assert.throws(() => client.decodeBoundedPlainText({
    id: "m", threadId: "t", labelIds: [],
    payload: { parts: Array.from({ length: 101 }, () => ({})) },
  }), /MIME structure/i);
  let nested = {};
  for (let index = 0; index < 11; index += 1) nested = { parts: [nested] };
  assert.throws(() => client.decodeBoundedPlainText({
    id: "m", threadId: "t", labelIds: [], payload: nested,
  }), /MIME structure/i);
});

test("MIME decoding prefers plain text and safely falls back to HTML", () => {
  const encoded = value => Buffer.from(value).toString("base64url");
  const part = (mimeType, value, extra = {}) => ({
    mimeType, body: { data: encoded(value), size: Buffer.byteLength(value) }, ...extra,
  });
  assert.equal(client.decodeBoundedPlainText({
    id: "m", threadId: "t", labelIds: [],
    payload: { parts: [part("text/html", "<b>HTML</b>"), part("text/plain", "Plain")] },
  }), "Plain");
  assert.equal(client.decodeBoundedPlainText({
    id: "m", threadId: "t", labelIds: [],
    payload: { parts: [part("text/html; charset=UTF-8", "<p>Only HTML</p>")] },
  }), "<p>Only HTML</p>");
});

test("MIME decoding ignores attachments and forwarded message bodies", () => {
  const encoded = value => Buffer.from(value).toString("base64url");
  const hidden = [
    { mimeType: "text/plain", filename: "notes.txt", body: { data: encoded("filename secret") } },
    {
      mimeType: "text/plain",
      headers: [{ name: "Content-Disposition", value: " attachment; filename=mail.txt" }],
      body: { data: encoded("attachment secret") },
    },
    {
      mimeType: "message/rfc822",
      parts: [{ mimeType: "text/plain", body: { data: encoded("forwarded secret") } }],
    },
  ];
  assert.equal(client.decodeBoundedPlainText({
    id: "m", threadId: "t", labelIds: [],
    payload: {
      parts: [
        ...hidden,
        { mimeType: "text/plain", body: { data: encoded("Actual reply") } },
      ],
    },
  }), "Actual reply");
  assert.equal(client.decodeBoundedPlainText({
    id: "m", threadId: "t", labelIds: [], payload: { parts: hidden },
  }), null);
});

test("MIME decoding counts inserted separators in the final UTF-8 bound", () => {
  const encoded = value => Buffer.from(value).toString("base64url");
  assert.throws(() => client.decodeBoundedPlainText({
    id: "m", threadId: "t", labelIds: [],
    payload: {
      parts: [
        { mimeType: "text/plain", body: { data: encoded("a".repeat(5_000)), size: 5_000 } },
        { mimeType: "text/plain", body: { data: encoded("b".repeat(5_000)), size: 5_000 } },
      ],
    },
  }), /size limit/i);
});

test.after(async () => {
  delete globalThis.__gmailDbState;
  delete globalThis.__gmailApi;
  delete globalThis.__gmailProcessCalls;
  delete globalThis.__gmailProcessResult;
  delete globalThis.__gmailProcessError;
  delete globalThis.__gmailServiceCalls;
  delete globalThis.__gmailConnectorCalls;
  delete globalThis.__gmailConnectorResponse;
  await rm(tempDir, { recursive: true, force: true });
});