import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const apiRoot = path.resolve(import.meta.dirname, "../..");
const outreachSource = path.join(apiRoot, "src/lib/outreach.ts");
const policySource = path.join(apiRoot, "src/outreach/followupPolicy.ts");

/*
 * The bundled module is deliberately given a small in-memory database rather
 * than a test database. This keeps this test hermetic while still executing
 * the production outreach.ts module, including its ORM predicates and
 * reservation/update flow. Instantly itself is mocked; the production module
 * still owns all eligibility, cap, and state transitions.
 */
const dbMock = String.raw`
const table = (name, columns) => Object.assign({ __table: name }, Object.fromEntries(
  columns.map((column) => [column, { __column: column, __table: name }]),
));

export const restaurantsTable = table("restaurants", [
  "placeId", "name", "city", "rating", "website", "cuisineTags",
  "publicBusinessEmail", "suppressedAt", "claimedAt", "claimStatus",
  "claimAttemptId", "outreachCount", "outreachStatus", "nextOutreachAfter",
  "importedAt", "unsubscribeTokenHash", "outreachFailure", "lastOutreachAt",
]);
export const gmailOutreachThreadsTable = table("gmail_outreach_threads", [
  "threadId", "sentMessageId", "placeId",
]);
export const gmailHistoryMessagesTable = table("gmail_history_messages", [
  "messageId", "threadId",
]);
export const outreachAuditTable = table("outreach_audit", [
  "id", "placeId", "event", "createdAt", "recipientDomain", "detail",
]);

const tableRows = (table) => {
  const state = globalThis.__outreachMockState;
  if (table.__table === "restaurants") return state.restaurants;
  if (table.__table === "gmail_outreach_threads") return state.threads;
  if (table.__table === "gmail_history_messages") return state.historyMessages;
  if (table.__table === "outreach_audit") return state.audits;
  throw new Error("Unknown mock table: " + table.__table);
};

const state = () => globalThis.__outreachMockState;
const columnValue = (column, context) => {
  const row = context.byTable[column.__table];
  return row?.[column.__column];
};
const formatSqlValue = (value) => {
  if (value && value.__column) return value.__table + "." + value.__column;
  return String(value);
};

export function sql(strings, ...values) {
  return {
    __kind: "sql",
    strings: Array.from(strings),
    values,
    text: strings.map((part, index) =>
      part + (index < values.length ? formatSqlValue(values[index]) : "")).join(""),
  };
}

export function eq(column, value) {
  return { __kind: "eq", column, value };
}
export function isNull(column) {
  return { __kind: "isNull", column };
}
export function gte(column, value) {
  return { __kind: "gte", column, value };
}
export function lte(column, value) {
  return { __kind: "lte", column, value };
}
export function and(...conditions) {
  return { __kind: "and", conditions: conditions.filter(Boolean) };
}
export function or(...conditions) {
  return { __kind: "or", conditions: conditions.filter(Boolean) };
}

function matches(condition, context) {
  if (!condition) return true;
  switch (condition.__kind) {
    case "and":
      return condition.conditions.every((child) => matches(child, context));
    case "or":
      return condition.conditions.some((child) => matches(child, context));
    case "eq":
      return columnValue(condition.column, context) === condition.value;
    case "isNull":
      return columnValue(condition.column, context) == null;
    case "gte":
      return new Date(columnValue(condition.column, context)).getTime() >=
        new Date(condition.value).getTime();
    case "lte":
      return new Date(columnValue(condition.column, context)).getTime() <=
        new Date(condition.value).getTime();
    case "sql": {
      const text = condition.text;
      const currentState = state();
      if (text.includes("not exists")) {
        const restaurant = context.byTable.restaurants;
        if (!restaurant) return true;
        return !currentState.threads.some((thread) =>
          thread.placeId === restaurant.placeId &&
          currentState.historyMessages.some((message) =>
            message.threadId === thread.threadId &&
            message.messageId !== thread.sentMessageId));
      }
      if (text.includes("exists (select 1 from")) {
        const hash = condition.values.find((value) => typeof value === "string");
        const restaurant = context.byTable.restaurants;
        return currentState.audits.some((audit) =>
          audit.placeId === restaurant?.placeId &&
          audit.event === "unsubscribe_token" &&
          audit.detail === hash);
      }
      if (text.includes("<>")) {
        const message = context.byTable.gmail_history_messages;
        const thread = context.byTable.gmail_outreach_threads;
        return Boolean(message && thread && message.messageId !== thread.sentMessageId);
      }
      return true;
    }
    default:
      throw new Error("Unknown mock condition: " + condition.__kind);
  }
}

const contextFor = (table, row) => ({ byTable: { [table.__table]: row } });
const project = (selection, context) => Object.fromEntries(
  Object.entries(selection).map(([key, value]) => [key, columnValue(value, context)]),
);

class SelectQuery {
  constructor(selection) {
    this.selection = selection;
    this.source = null;
    this.join = null;
    this.condition = null;
    this.maxRows = Infinity;
    this.orderColumn = null;
  }
  from(table) {
    this.source = table;
    return this;
  }
  innerJoin(table, condition) {
    this.join = { table, condition };
    return this;
  }
  where(condition) {
    this.condition = condition;
    return this;
  }
  orderBy(column) {
    this.orderColumn = column;
    return this;
  }
  limit(maxRows) {
    this.maxRows = maxRows;
    return this;
  }
  async execute() {
    let contexts = [];
    const sourceRows = tableRows(this.source);
    if (!this.join) {
      contexts = sourceRows.map((row) => contextFor(this.source, row));
    } else {
      const joinRows = tableRows(this.join.table);
      for (const sourceRow of sourceRows) {
        for (const joinRow of joinRows) {
          const context = {
            byTable: {
              [this.source.__table]: sourceRow,
              [this.join.table.__table]: joinRow,
            },
          };
          if (matches(this.join.condition, context)) contexts.push(context);
        }
      }
    }
    contexts = contexts.filter((context) => matches(this.condition, context));
    if (this.orderColumn) {
      contexts.sort((left, right) =>
        new Date(columnValue(this.orderColumn, left)).getTime() -
        new Date(columnValue(this.orderColumn, right)).getTime());
    }
    contexts = contexts.slice(0, this.maxRows);
    if (!this.selection) return contexts.map((context) => ({ ...context.byTable[this.source.__table] }));
    const aggregate = Object.values(this.selection).some((value) =>
      value?.__kind === "sql" && value.text.includes("count(*)"));
    if (aggregate) {
      const key = Object.keys(this.selection)[0];
      return [{ [key]: contexts.length }];
    }
    return contexts.map((context) => project(this.selection, context));
  }
  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

function sqlSetValue(value, row) {
  if (!value?.__kind) return value;
  if (value.__kind !== "sql") return value;
  if (value.text.includes("case when")) {
    const nextStatus = value.text.includes("'instantly_queued'")
      ? "instantly_queued"
      : value.values.find((candidate) =>
        ["sent", "followup_sent", "final_followup_sent"].includes(candidate));
    return row.outreachStatus === "sending" &&
      row.suppressedAt == null && row.claimedAt == null
      ? nextStatus
      : row.outreachStatus;
  }
  if (value.text.includes("+ 1")) return Number(row.outreachCount ?? 0) + 1;
  return value;
}

class UpdateQuery {
  constructor(table) {
    this.table = table;
    this.valuesToSet = {};
    this.condition = null;
    this.selection = null;
  }
  set(values) {
    this.valuesToSet = values;
    return this;
  }
  where(condition) {
    this.condition = condition;
    return this;
  }
  returning(selection) {
    this.selection = selection;
    return this;
  }
  async execute() {
    const currentState = state();
    if (this.table === restaurantsTable &&
      this.valuesToSet.outreachStatus === "sending" &&
      currentState.beforeReservation) {
      const hook = currentState.beforeReservation;
      currentState.beforeReservation = null;
      hook();
    }
    const changed = [];
    for (const row of tableRows(this.table)) {
      const context = contextFor(this.table, row);
      if (!matches(this.condition, context)) continue;
      for (const [key, value] of Object.entries(this.valuesToSet)) {
        row[key] = sqlSetValue(value, row);
      }
      changed.push(row);
    }
    if (!this.selection) return [];
    return changed.map((row) => project(this.selection, contextFor(this.table, row)));
  }
  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

class InsertQuery {
  constructor(table) {
    this.table = table;
    this.input = null;
  }
  values(input) {
    this.input = input;
    return this;
  }
  async execute() {
    const currentState = state();
    const rows = tableRows(this.table);
    const values = { ...this.input };
    if (this.table === outreachAuditTable) {
      values.id = ++currentState.nextAuditId;
      values.createdAt ??= new Date();
    }
    rows.push(values);
  }
  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

export const db = {
  select(selection) {
    return new SelectQuery(selection);
  },
  update(table) {
    return new UpdateQuery(table);
  },
  insert(table) {
    return new InsertQuery(table);
  },
  async transaction(callback) {
    const currentState = state();
    const snapshot = structuredClone({
      restaurants: currentState.restaurants,
      threads: currentState.threads,
      historyMessages: currentState.historyMessages,
      audits: currentState.audits,
      nextAuditId: currentState.nextAuditId,
    });
    try {
      return await callback(this);
    } catch (error) {
      currentState.restaurants = snapshot.restaurants;
      currentState.threads = snapshot.threads;
      currentState.historyMessages = snapshot.historyMessages;
      currentState.audits = snapshot.audits;
      currentState.nextAuditId = snapshot.nextAuditId;
      throw error;
    }
  },
};

export const pool = {
  async connect() {
    return {
      async query(query) {
        if (query.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
        return { rows: [] };
      },
      release() {},
    };
  },
};
`;

const ormMock = String.raw`
export { and, eq, gte, isNull, lte, or, sql } from "@workspace/db";
`;

const instantlyMock = String.raw`
export function assertInstantlyCampaignConfiguration() {}
export async function withInstantlyRestaurantLock(_placeId, operation) { return operation(); }
export async function requestInstantlyCampaignCancellation() {
  globalThis.__outreachMockState.cancellationRequests += 1;
}
export async function drainInstantlyCampaignCancellations() {
  globalThis.__outreachMockState.cancellationDrains += 1;
}
export async function reconcileInstantlyInboxFully() {
  const state = globalThis.__outreachMockState;
  state.reconcileCalls += 1;
  if (state.beforeReconciliation) {
    const hook = state.beforeReconciliation;
    state.beforeReconciliation = null;
    hook();
  }
  return { processed: 0, skipped: 0, failed: 0 };
}
export async function reconcileInstantlySentMessages() { return 0; }
export async function sendInstantlyEmail(draft, email, sequenceId) {
  const state = globalThis.__outreachMockState;
  state.connectorCalls.push({ service: "instantly", draft, email, sequenceId });
  const suffix = String(state.connectorCalls.length).padStart(12, "0");
  return { campaignId: "00000000-0000-4000-8000-" + suffix, leadId: "00000000-0000-4000-8001-" + suffix, activated: true };
}
`;

const cancellationIntentsMock = String.raw`
export async function enqueueAllInstantlyCancellationIntents() {
  if (globalThis.__outreachMockState.failCancellationIntent) {
    throw new Error("cancellation intent insert failed");
  }
  globalThis.__outreachMockState.cancellationRequests += 1;
}
`;

const publicUrlMock = String.raw`
export async function assertPublicHttpsUrl() {
  return new URL("https://thefoodadvisor.co.uk/");
}
`;

const enrichmentMock = String.raw`
export async function enrichRestaurant(placeId) {
  const currentState = globalThis.__outreachMockState;
  currentState.enrichmentCalls.push(placeId);
  return {
    ok: true,
    placeId,
    email: currentState.enrichmentEmail ?? null,
    finalUrl: "https://example.test/",
    cuisine: { cuisines: [], dietaryTags: [] },
  };
}
`;

const generatorMock = String.raw`
export async function generateOutreachFor() {
  return { subject: "mock", body: "mock" };
}
`;

const mockSources = new Map([
  ["@workspace/db", dbMock],
  ["drizzle-orm", ormMock],
  ["instantly-service", instantlyMock],
  ["cancellation-intents", cancellationIntentsMock],
  ["public-url", publicUrlMock],
  ["enrichment", enrichmentMock],
  ["message-generator", generatorMock],
]);

async function bundleOutreach() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "outreach-followup-"));
  const output = path.join(tempDir, "outreach.mjs");
  const publicUrlSource = path.join(apiRoot, "src/lib/public-url.ts");
  const enrichmentSource = path.join(apiRoot, "src/services/enrichment/enrichRestaurant.ts");
  const generatorSource = path.join(apiRoot, "src/outreach/messageGenerator.ts");
  const instantlyServiceSource = path.join(apiRoot, "src/outreach/instantlyService.ts");
  const cancellationIntentsSource = path.join(apiRoot, "src/services/instantly/cancellationIntents.ts");
  await build({
    entryPoints: [outreachSource],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    write: true,
    plugins: [{
      name: "outreach-test-mocks",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /.*/ }, (args) => {
          if (mockSources.has(args.path)) {
            return { path: args.path, namespace: "outreach-mock" };
          }
          if (args.path.includes("instantlyService")) {
            return { path: "instantly-service", namespace: "outreach-mock" };
          }
          if (args.path.includes("cancellationIntents")) {
            return { path: "cancellation-intents", namespace: "outreach-mock" };
          }
          const resolved = path.resolve(path.dirname(args.importer), args.path);
          if (resolved === publicUrlSource) {
            return { path: "public-url", namespace: "outreach-mock" };
          }
          if (resolved === enrichmentSource) {
            return { path: "enrichment", namespace: "outreach-mock" };
          }
          if (resolved === generatorSource) {
            return { path: "message-generator", namespace: "outreach-mock" };
          }
          if (resolved === instantlyServiceSource) {
            return { path: "instantly-service", namespace: "outreach-mock" };
          }
          if (resolved === cancellationIntentsSource) {
            return { path: "cancellation-intents", namespace: "outreach-mock" };
          }
          return undefined;
        });
        pluginBuild.onLoad({ filter: /.*/, namespace: "outreach-mock" }, (args) => ({
          contents: mockSources.get(args.path),
          loader: "js",
        }));
      },
    }],
  });
  return { output, tempDir };
}

const bundled = await bundleOutreach();
const outreach = await import(pathToFileURL(bundled.output).href);
const policy = await import(pathToFileURL(policySource).href);

test.after(async () => {
  await rm(bundled.tempDir, { recursive: true, force: true });
});

function newState() {
  return {
    restaurants: [],
    threads: [],
    historyMessages: [],
    audits: [],
    nextAuditId: 0,
    connectorCalls: [],
    enrichmentCalls: [],
    enrichmentEmail: null,
    beforeReservation: null,
    beforeReconciliation: null,
    reconcileCalls: 0,
    cancellationRequests: 0,
    cancellationDrains: 0,
    failCancellationIntent: false,
  };
}

function restaurant(placeId, overrides = {}) {
  return {
    placeId,
    name: "The Test Restaurant",
    city: "London",
    rating: 4.5,
    website: null,
    cuisineTags: ["British"],
    publicBusinessEmail: "info@example.com",
    suppressedAt: null,
    claimedAt: null,
    claimStatus: null,
    claimAttemptId: null,
    outreachCount: 1,
    outreachStatus: "sent",
    nextOutreachAfter: null,
    importedAt: new Date("2025-01-01T00:00:00.000Z"),
    unsubscribeTokenHash: null,
    outreachFailure: null,
    lastOutreachAt: null,
    ...overrides,
  };
}

function audit(placeId, event, createdAt, detail = null) {
  return { placeId, event, createdAt: new Date(createdAt), detail };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function setState(value) {
  globalThis.__outreachMockState = value;
  process.env.OUTREACH_ENABLED = "true";
  process.env.INSTANTLY_CAMPAIGN_CREATION_ENABLED = "true";
  process.env.PUBLIC_APP_URL = "https://thefoodadvisor.co.uk";
  process.env.OUTREACH_DAILY_LIMIT = "20";
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

test("followup policy is due at exact three- and seven-day boundaries", () => {
  const firstSent = new Date("2026-01-01T12:00:00.000Z");
  const secondSent = new Date("2026-01-02T12:00:00.000Z");
  const emailOne = [
    { event: "send_attempt", createdAt: firstSent, detail: '{"emailNumber":1}' },
    { event: "sent", createdAt: firstSent, detail: '{"emailNumber":1}' },
  ];
  assert.equal(policy.isFollowupDue(2, emailOne, new Date(firstSent.getTime() + 3 * 86400000 - 1)), false);
  assert.equal(policy.isFollowupDue(2, emailOne, new Date(firstSent.getTime() + 3 * 86400000)), true);

  const emailTwo = [
    ...emailOne,
    { event: "send_attempt", createdAt: secondSent, detail: '{"emailNumber":2}' },
    { event: "sent", createdAt: secondSent, detail: '{"emailNumber":2}' },
  ];
  assert.equal(policy.isFollowupDue(3, emailTwo, new Date(firstSent.getTime() + 7 * 86400000 - 1)), false);
  assert.equal(policy.isFollowupDue(3, emailTwo, new Date(firstSent.getTime() + 7 * 86400000)), true);
});

test("followup policy requires a full one-day gap after email 2", () => {
  const firstSent = new Date("2026-01-01T12:00:00.000Z");
  const secondSent = new Date("2026-01-07T13:00:00.000Z");
  const history = [
    { event: "send_attempt", createdAt: firstSent, detail: '{"emailNumber":1}' },
    { event: "sent", createdAt: firstSent, detail: '{"emailNumber":1}' },
    { event: "send_attempt", createdAt: secondSent, detail: '{"emailNumber":2}' },
    { event: "sent", createdAt: secondSent, detail: '{"emailNumber":2}' },
  ];
  assert.equal(policy.isFollowupDue(3, history, new Date("2026-01-08T12:59:59.999Z")), false);
  assert.equal(policy.isFollowupDue(3, history, new Date("2026-01-08T13:00:00.000Z")), true);
});

test("real runDailyOutreach queues followup step 2 through Instantly", async () => {
  const current = newState();
  current.restaurants.push(restaurant("step-two"));
  current.audits.push(
    audit("step-two", "send_attempt", daysAgo(4), '{"emailNumber":1}'),
    audit("step-two", "sent", daysAgo(4), '{"emailNumber":1}'),
  );
  setState(current);

  const result = await outreach.runDailyOutreach({ placeId: "step-two", followupStep: 2 });
  assert.deepEqual(result, { discovered: 0, sent: 0, reconciled: 0, queued: 1, skipped: 0, failed: 0, dailyMaximum: 20 });
  assert.equal(current.restaurants[0].outreachStatus, "instantly_queued");
  assert.equal(current.restaurants[0].outreachCount, 1);
  assert.equal(current.audits.at(-1).event, "instantly_activated");
  assert.equal(current.connectorCalls.length, 1);
  assert.equal(current.connectorCalls[0].sequenceId, 2);
  assert.equal(current.cancellationDrains, 1);
});

test("real runDailyOutreach queues followup step 3 through Instantly", async () => {
  const current = newState();
  current.restaurants.push(restaurant("step-three", {
    outreachCount: 2,
    outreachStatus: "followup_sent",
  }));
  current.audits.push(
    audit("step-three", "send_attempt", daysAgo(8), '{"emailNumber":1}'),
    audit("step-three", "sent", daysAgo(8), '{"emailNumber":1}'),
    audit("step-three", "send_attempt", daysAgo(2), '{"emailNumber":2}'),
    audit("step-three", "sent", daysAgo(2), '{"emailNumber":2}'),
  );
  setState(current);

  const result = await outreach.runDailyOutreach({ placeId: "step-three", followupStep: 3 });
  assert.deepEqual(result, { discovered: 0, sent: 0, reconciled: 0, queued: 1, skipped: 0, failed: 0, dailyMaximum: 20 });
  assert.equal(current.restaurants[0].outreachStatus, "instantly_queued");
  assert.equal(current.restaurants[0].outreachCount, 2);
  assert.equal(current.connectorCalls.length, 1);
  assert.equal(current.connectorCalls[0].sequenceId, 3);
});

test("daily attempt limit reserves no followup slot after today's attempt", async () => {
  const current = newState();
  current.restaurants.push(restaurant("daily-limit"));
  current.audits.push(
    audit("another-place", "send_attempt", new Date()),
    audit("daily-limit", "send_attempt", daysAgo(4), '{"emailNumber":1}'),
    audit("daily-limit", "sent", daysAgo(4), '{"emailNumber":1}'),
  );
  setState(current);
  process.env.OUTREACH_DAILY_LIMIT = "1";

  const result = await outreach.runDailyOutreach({ placeId: "daily-limit", followupStep: 2 });
  assert.deepEqual(result, { discovered: 0, sent: 0, reconciled: 0, queued: 0, skipped: 0, failed: 0, dailyMaximum: 20 });
  assert.equal(current.connectorCalls.length, 0);
});

test("previous unconfirmed attempt is skipped and never retried", async () => {
  const current = newState();
  current.restaurants.push(restaurant("unconfirmed"));
  current.audits.push(audit("unconfirmed", "send_attempt", daysAgo(4), '{"emailNumber":1}'));
  setState(current);

  const result = await outreach.runDailyOutreach({ placeId: "unconfirmed", followupStep: 2 });
  assert.equal(result.queued, 0);
  assert.equal(result.skipped, 1);
  assert.equal(current.connectorCalls.length, 0);
});

test("selection excludes suppressed, claimed, claim-status, claim-attempt, and staged-reply rows", async () => {
  const current = newState();
  current.restaurants.push(
    restaurant("eligible", { importedAt: new Date("2025-01-01T00:00:00.000Z") }),
    restaurant("suppressed", { suppressedAt: new Date() }),
    restaurant("claimed", { claimedAt: new Date() }),
    restaurant("claim-status", { claimStatus: "pending" }),
    restaurant("claim-attempt", { claimAttemptId: "claim-1" }),
    restaurant("unreadable-reply"),
  );
  current.audits.push(
    audit("eligible", "send_attempt", daysAgo(4), '{"emailNumber":1}'),
    audit("eligible", "sent", daysAgo(4), '{"emailNumber":1}'),
    audit("unreadable-reply", "send_attempt", daysAgo(4), '{"emailNumber":1}'),
    audit("unreadable-reply", "sent", daysAgo(4), '{"emailNumber":1}'),
  );
  current.threads.push({
    placeId: "unreadable-reply",
    threadId: "thread-with-inbound",
    sentMessageId: "original-outbound",
  });
  current.historyMessages.push({
    threadId: "thread-with-inbound",
    messageId: "unreadable-inbound",
  });
  setState(current);

  const result = await outreach.runDailyOutreach({ followupStep: 2 });
  assert.equal(result.queued, 1);
  assert.equal(current.connectorCalls.length, 1);
  for (const placeId of ["suppressed", "claimed", "claim-status", "claim-attempt", "unreadable-reply"]) {
    assert.equal(current.restaurants.find((row) => row.placeId === placeId).outreachCount, 1);
  }
});

test("reservation rechecks suppression and staged replies before provider send", async () => {
  const current = newState();
  current.restaurants.push(restaurant("reservation-race"));
  current.audits.push(
    audit("reservation-race", "send_attempt", daysAgo(4), '{"emailNumber":1}'),
    audit("reservation-race", "sent", daysAgo(4), '{"emailNumber":1}'),
  );
  current.beforeReservation = () => {
    current.restaurants[0].suppressedAt = new Date();
  };
  setState(current);

  const result = await outreach.runDailyOutreach({ placeId: "reservation-race", followupStep: 2 });
  assert.equal(result.queued, 0);
  assert.equal(result.skipped, 1);
  assert.equal(current.connectorCalls.length, 0);
  assert.equal(current.audits.some((item) => item.event === "send_attempt" && item.placeId === "reservation-race" && item.createdAt > daysAgo(1)), false);
});

test("reservation blocks an unreadable inbound reply that arrives after selection", async () => {
  const current = newState();
  current.restaurants.push(restaurant("staged-race"));
  current.audits.push(
    audit("staged-race", "send_attempt", daysAgo(4), '{"emailNumber":1}'),
    audit("staged-race", "sent", daysAgo(4), '{"emailNumber":1}'),
  );
  current.beforeReservation = () => {
    current.threads.push({
      placeId: "staged-race",
      threadId: "thread-arrived-during-run",
      sentMessageId: "original-outbound",
    });
    current.historyMessages.push({
      threadId: "thread-arrived-during-run",
      messageId: "unreadable-inbound",
    });
  };
  setState(current);

  const result = await outreach.runDailyOutreach({ placeId: "staged-race", followupStep: 2 });
  assert.equal(result.queued, 0);
  assert.equal(result.skipped, 1);
  assert.equal(current.connectorCalls.length, 0);
});

test("a reconciled Instantly reply blocks a new campaign before reservation", async () => {
  const current = newState();
  current.restaurants.push(restaurant("instantly-reply-race", {
    outreachCount: 0,
    outreachStatus: "pending",
  }));
  current.beforeReconciliation = () => {
    current.restaurants[0].outreachStatus = "replied";
  };
  setState(current);

  const result = await outreach.runDailyOutreach({ placeId: "instantly-reply-race", initialOnly: true });
  assert.equal(current.reconcileCalls, 1);
  assert.equal(result.queued, 0);
  assert.equal(current.connectorCalls.length, 0);
});

test("followup preserves an earlier unsubscribe token and suppresses with it", async () => {
  const current = newState();
  const oldToken = "old-unsubscribe-token-which-is-at-least-32-characters";
  const oldHash = sha256(oldToken);
  current.restaurants.push(restaurant("old-token", { unsubscribeTokenHash: oldHash }));
  current.audits.push(
    audit("old-token", "send_attempt", daysAgo(4), '{"emailNumber":1}'),
    audit("old-token", "sent", daysAgo(4), '{"emailNumber":1}'),
  );
  setState(current);

  const result = await outreach.runDailyOutreach({ placeId: "old-token", followupStep: 2 });
  assert.equal(result.queued, 1);
  assert.equal(current.audits.some((item) =>
    item.event === "unsubscribe_token" && item.detail === oldHash), true);
  assert.notEqual(current.restaurants[0].unsubscribeTokenHash, oldHash);

  const suppressed = await outreach.suppressByToken(oldToken);
  assert.equal(suppressed, true);
  assert.equal(current.restaurants[0].outreachStatus, "suppressed");
  assert.equal(current.restaurants[0].publicBusinessEmail, null);
  assert.equal(current.audits.at(-1).event, "unsubscribed");
  assert.equal(current.cancellationRequests, 1);
});

test("unsubscribe state rolls back when its cancellation intent cannot be recorded", async () => {
  const current = newState();
  const token = "atomic-unsubscribe-token-which-is-at-least-32-characters";
  current.restaurants.push(restaurant("atomic-unsubscribe", {
    unsubscribeTokenHash: sha256(token),
  }));
  current.failCancellationIntent = true;
  setState(current);

  await assert.rejects(() => outreach.suppressByToken(token), /cancellation intent insert failed/);
  assert.equal(current.restaurants[0].outreachStatus, "sent");
  assert.equal(current.restaurants[0].suppressedAt, null);
  assert.equal(current.audits.length, 0);
});

test("source retains SQL barriers in both selection and reservation", async () => {
  const source = await readFile(outreachSource, "utf8");
  assert.equal((source.match(/noStagedReplies\(\)/g) ?? []).length >= 2, true);
  assert.match(source, /isNull\(restaurantsTable\.suppressedAt\)/);
  assert.match(source, /isNull\(restaurantsTable\.claimedAt\)/);
  assert.match(source, /isNull\(restaurantsTable\.claimStatus\)/);
  assert.match(source, /isNull\(restaurantsTable\.claimAttemptId\)/);
  assert.match(source, /messageId\} <> \$\{gmailOutreachThreadsTable\.sentMessageId\}/);
  assert.match(source, /event: "unsubscribe_token"/);
});