import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(path.join(tmpdir(), "better-contact-tests-"));
const outfile = path.join(directory, "service.mjs");

const dbStub = String.raw`
const column = (table, key) => ({ table, key });
const makeTable = (name, keys) => {
  const table = { __name: name };
  for (const key of keys) table[key] = column(table, key);
  return table;
};
export const restaurantsTable = makeTable("restaurants", ["placeId"]);
export const betterContactBudgetsTable = makeTable("budgets",
  ["period","creditCap","reservedCredits","consumedCredits","updatedAt"]);
export const betterContactJobsTable = makeTable("jobs",
  ["id","placeId","contextHash","firstName","lastName","company","companyDomain",
   "personSource","budgetPeriod","reservedCredits","status","providerRequestId",
   "pollAttempts","nextPollAt","deadlineAt","postStartedAt","completedAt",
   "lastError","createdAt","updatedAt"]);
export const betterContactPrivateContactsTable = makeTable("contacts",
  ["id","jobId","placeId","firstName","lastName","email","providerEmailStatus",
   "reviewOnly","outreachEligible","createdAt"]);
export const betterContactAuditTable = makeTable("audits",
  ["id","jobId","placeId","event","detail","createdAt"]);

const state = () => globalThis.__betterContactState;
const rows = (table) => state()[table.__name];
const value = (row, operand) => operand?.table ? row[operand.key] : operand;
const matches = (row, condition) => {
  if (!condition) return true;
  if (condition.kind === "and") return condition.conditions.every((part) => matches(row, part));
  if (condition.kind === "eq") return value(row, condition.left) === value(row, condition.right);
  if (condition.kind === "lte") return value(row, condition.left) <= value(row, condition.right);
  if (condition.kind === "in") return condition.values.includes(value(row, condition.left));
  if (condition.kind === "sql") {
    const budget = row;
    const numbers = condition.values.filter((item) => typeof item === "number");
    const reserve = numbers[0] ?? 1;
    const cap = numbers.at(-1);
    return budget.reservedCredits + budget.consumedCredits + reserve
      <= Math.min(budget.creditCap, cap);
  }
  return true;
};
const evaluateSet = (row, item) => {
  if (!item || item.kind !== "sql") return item;
  const text = item.strings.join(" ");
  const number = item.values.find((entry) => typeof entry === "number") ?? 0;
  const referenced = item.values.find((entry) => entry?.key)?.key;
  if (text.includes("greatest")) return Math.max(0, Number(row[referenced] ?? 0) - number);
  if (text.includes("+")) return Number(row[referenced] ?? 0) + number;
  return item;
};
const project = (row, fields) => {
  if (!fields) return { ...row };
  return Object.fromEntries(Object.entries(fields).map(([name, col]) => [name, row[col.key]]));
};

class Query {
  constructor(kind, table, fields) {
    this.kind = kind; this.table = table; this.fields = fields;
  }
  from(table) { this.table = table; return this; }
  values(values) { this.input = Array.isArray(values) ? values : [values]; return this; }
  set(values) { this.input = values; return this; }
  where(condition) { this.condition = condition; return this; }
  limit(limit) { this.max = limit; return this; }
  onConflictDoNothing() { this.ignoreConflict = true; return this; }
  returning(fields) { this.returnFields = fields ?? null; this.wantsReturning = true; return this; }
  then(resolve, reject) {
    try { resolve(this.execute()); } catch (error) { reject(error); }
  }
  execute() {
    if (this.kind === "select") {
      let found = rows(this.table).filter((row) => matches(row, this.condition));
      if (this.max !== undefined) found = found.slice(0, this.max);
      return found.map((row) => project(row, this.fields));
    }
    if (this.kind === "insert") {
      const inserted = [];
      for (const raw of this.input) {
        const row = {
          pollAttempts: 0, reservedCredits: 0, consumedCredits: 0,
          reviewOnly: true, outreachEligible: false, createdAt: new Date(),
          updatedAt: new Date(), ...raw,
        };
        const existing = this.table.__name === "budgets"
          ? rows(this.table).find((item) => item.period === row.period)
          : this.table.__name === "jobs"
            ? rows(this.table).find((item) =>
                item.id === row.id
                || (item.placeId === row.placeId && item.contextHash === row.contextHash))
            : this.table.__name === "contacts"
              ? rows(this.table).find((item) => item.jobId === row.jobId)
              : null;
        if (existing) {
          if (this.ignoreConflict) continue;
          throw new Error("unique violation");
        }
        rows(this.table).push(row); inserted.push(row);
      }
      return this.wantsReturning
        ? inserted.map((row) => project(row, this.returnFields))
        : [];
    }
    const changed = [];
    for (const row of rows(this.table)) {
      if (!matches(row, this.condition)) continue;
      for (const [key, item] of Object.entries(this.input)) row[key] = evaluateSet(row, item);
      changed.push(row);
    }
    return this.wantsReturning
      ? changed.map((row) => project(row, this.returnFields))
      : [];
  }
}

let transactionTail = Promise.resolve();
export const db = {
  select(fields) { return new Query("select", null, fields); },
  insert(table) { return new Query("insert", table); },
  update(table) { return new Query("update", table); },
  transaction(operation) {
    const run = async () => {
      const snapshot = structuredClone(state());
      try { return await operation(db); }
      catch (error) {
        for (const key of Object.keys(snapshot)) state()[key] = snapshot[key];
        throw error;
      }
    };
    const result = transactionTail.then(run, run);
    transactionTail = result.catch(() => {});
    return result;
  },
};
`;

const ormStub = String.raw`
export const eq = (left, right) => ({ kind: "eq", left, right });
export const lte = (left, right) => ({ kind: "lte", left, right });
export const inArray = (left, values) => ({ kind: "in", left, values });
export const and = (...conditions) => ({ kind: "and", conditions });
export const sql = (strings, ...values) => ({ kind: "sql", strings: [...strings], values });
`;

const connectorStub = String.raw`
export class ReplitConnectors {
  async proxy(connector, path, options) {
    const state = globalThis.__betterContactState;
    state.proxyCalls.push({ connector, path, options });
    const next = state.responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("Unexpected provider call");
    return next;
  }
}
`;

await build({
  entryPoints: [path.join(import.meta.dirname, "betterContact.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "better-contact-boundaries",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "mock" }));
      builder.onResolve({ filter: /^drizzle-orm$/ }, () => ({ path: "orm", namespace: "mock" }));
      builder.onResolve({ filter: /^@replit\/connectors-sdk$/ }, () =>
        ({ path: "connector", namespace: "mock" }));
      builder.onLoad({ filter: /^db$/, namespace: "mock" }, () => ({ contents: dbStub }));
      builder.onLoad({ filter: /^orm$/, namespace: "mock" }, () => ({ contents: ormStub }));
      builder.onLoad({ filter: /^connector$/, namespace: "mock" }, () => ({ contents: connectorStub }));
    },
  }],
});

const service = await import(pathToFileURL(outfile).href);
const response = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});
const input = {
  placeId: "restaurant-1",
  firstName: "Jane",
  lastName: "Owner",
  company: "Jane Hospitality Ltd",
  companyDomain: "janes.example",
  personSource: "Admin reviewed Companies House filing",
  maxCredits: 1,
};
const current = () => globalThis.__betterContactState;
const budget = () => current().budgets[0];
const job = () => current().jobs[0];

beforeEach(() => {
  process.env.BETTERCONTACT_ENABLED = "true";
  process.env.BETTERCONTACT_MONTHLY_CREDIT_CAP = "2";
  globalThis.__betterContactState = {
    restaurants: [{ placeId: input.placeId }],
    budgets: [], jobs: [], contacts: [], audits: [],
    responses: [], proxyCalls: [],
  };
});
after(async () => {
  delete globalThis.__betterContactState;
  await rm(directory, { recursive: true, force: true });
});

test("concurrent identical reservations create one job and reserve one credit", async () => {
  const results = await Promise.all([
    service.reserveBetterContactJob(input),
    service.reserveBetterContactJob(input),
  ]);
  assert.equal(results.filter((item) => item.created).length, 1);
  assert.equal(current().jobs.length, 1);
  assert.equal(budget().reservedCredits, 1);
  assert.equal(budget().consumedCredits, 0);
});

test("201 acknowledgement persists provider id without consuming reservation", async () => {
  await service.reserveBetterContactJob(input);
  current().responses.push(response(201, { success: true, id: "provider-1" }));
  await service.processBetterContactJobs();
  assert.equal(job().status, "polling");
  assert.equal(job().providerRequestId, "provider-1");
  assert.equal(budget().reservedCredits, 1);
  assert.equal(current().proxyCalls.length, 1);
});

test("documented 4xx envelope releases reservation, while 5xx and timeout retain it", async () => {
  await service.reserveBetterContactJob(input);
  current().responses.push(response(402, { success: false, message: "You ran out of credits" }));
  await service.processBetterContactJobs();
  assert.equal(job().status, "failed");
  assert.equal(budget().reservedCredits, 0);

  globalThis.__betterContactState = {
    restaurants: [{ placeId: input.placeId }],
    budgets: [], jobs: [], contacts: [], audits: [], responses: [], proxyCalls: [],
  };
  await service.reserveBetterContactJob(input);
  current().responses.push(response(400, { message: "proxy-generated response" }));
  await service.processBetterContactJobs();
  assert.equal(job().status, "submit_ambiguous");
  assert.equal(budget().reservedCredits, 1);

  globalThis.__betterContactState = {
    restaurants: [{ placeId: input.placeId }],
    budgets: [], jobs: [], contacts: [], audits: [], responses: [], proxyCalls: [],
  };
  await service.reserveBetterContactJob(input);
  current().responses.push(response(500, { success: false, error: "Unexpected error" }));
  await service.processBetterContactJobs();
  assert.equal(job().status, "submit_ambiguous");
  assert.equal(budget().reservedCredits, 1);

  globalThis.__betterContactState = {
    restaurants: [{ placeId: input.placeId }],
    budgets: [], jobs: [], contacts: [], audits: [], responses: [], proxyCalls: [],
  };
  await service.reserveBetterContactJob(input);
  current().responses.push(new Error("BetterContact request timed out."));
  await service.processBetterContactJobs();
  assert.equal(job().status, "submit_ambiguous");
  assert.equal(budget().reservedCredits, 1);
});

test("restart recovery marks an interrupted POST ambiguous and never resubmits", async () => {
  await service.reserveBetterContactJob(input);
  Object.assign(job(), {
    status: "submitting",
    postStartedAt: new Date(Date.now() - 60_000),
  });
  await service.processBetterContactJobs();
  assert.equal(job().status, "submit_ambiguous");
  assert.equal(budget().reservedCredits, 1);
  assert.equal(current().proxyCalls.length, 0);
  assert.ok(current().audits.some((item) => item.event === "submit_ambiguous_recovered"));
});

test("202 remains pending; terminated exact identity moves reserved credit to consumed", async () => {
  await service.reserveBetterContactJob(input);
  current().responses.push(response(201, { success: true, id: "provider-2" }));
  await service.processBetterContactJobs();
  job().nextPollAt = new Date(0);
  current().responses.push(response(202, { id: "provider-2", status: "processing" }));
  await service.processBetterContactJobs();
  assert.equal(job().status, "polling");
  assert.equal(job().pollAttempts, 1);
  assert.deepEqual([budget().reservedCredits, budget().consumedCredits], [1, 0]);

  job().nextPollAt = new Date(0);
  current().responses.push(response(200, {
    id: "provider-2",
    status: "terminated",
    credits_consumed: 1,
    data: [{
      enriched: true,
      contact_first_name: "Jane",
      contact_last_name: "Owner",
      contact_email_address: "jane@janes.example",
      contact_email_address_status: "deliverable",
      custom_fields: [
        { name: "context_id", value: job().contextHash, position: 0 },
        { name: "restaurant_id", value: input.placeId, position: 1 },
      ],
    }],
  }));
  await service.processBetterContactJobs();
  assert.equal(job().status, "completed");
  assert.deepEqual([budget().reservedCredits, budget().consumedCredits], [0, 1]);
  assert.equal(current().contacts.length, 1);
  assert.equal(current().contacts[0].reviewOnly, true);
  assert.equal(current().contacts[0].outreachEligible, false);
});

test("terminated mismatched identity consumes reported credit but stores no contact", async () => {
  await service.reserveBetterContactJob(input);
  current().responses.push(response(201, { success: true, id: "provider-3" }));
  await service.processBetterContactJobs();
  job().nextPollAt = new Date(0);
  current().responses.push(response(200, {
    id: "provider-3",
    status: "terminated",
    credits_consumed: 1,
    data: [{
      enriched: true,
      contact_first_name: "Different",
      contact_last_name: "Person",
      contact_email_address: "person@janes.example",
      contact_email_address_status: "deliverable",
      custom_fields: [{ name: "context_id", value: job().contextHash, position: 0 }],
    }],
  }));
  await service.processBetterContactJobs();
  assert.deepEqual([budget().reservedCredits, budget().consumedCredits], [0, 1]);
  assert.equal(current().contacts.length, 0);
});