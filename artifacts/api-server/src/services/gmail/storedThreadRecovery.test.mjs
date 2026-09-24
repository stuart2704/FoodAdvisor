import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const temp = await mkdtemp(path.join(os.tmpdir(), "gmail-catch-up-"));
const target = path.join(temp, "recovery.mjs");
await build({
  entryPoints: [path.join(import.meta.dirname, "storedThreadRecovery.ts")],
  outfile: target, bundle: true, platform: "node", format: "esm",
  plugins: [{
    name: "recovery-fixtures",
    setup(builder) {
      const mocks = {
        "@workspace/db": `
          const column = name => name;
          export const gmailHistoryMessagesTable = { messageId: column("messageId") };
          export const gmailOutreachThreadsTable = { threadId: column("threadId"), sentMessageId: column("sentMessageId") };
          export const gmailWatchStateTable = { accountEmail: column("accountEmail") };
          const data = () => globalThis.__catchUp;
          class Query {
            constructor(selection) { this.selection = selection; }
            from(table) { this.table = table; return this; }
            where(test) { this.test = test; return this; }
            orderBy(order) { this.order = order; return this; }
            limit(n) { this.max = n; return this; }
            then(resolve, reject) {
              let rows = this.table === gmailWatchStateTable ? data().accounts : data().threads;
              rows = rows.filter(row => !this.test || this.test(row));
              if (this.order) rows = [...rows].sort((a, b) =>
                this.order.direction * a.threadId.localeCompare(b.threadId));
              return Promise.resolve(rows.slice(0, this.max ?? Infinity).map(row =>
                Object.fromEntries(Object.entries(this.selection).map(([key, col]) => [key, row[col]]))))
                .then(resolve, reject);
            }
          }
          export const db = {
            select: fields => new Query(fields),
            transaction: async fn => fn(db),
            insert: () => ({ values: row => ({ onConflictDoNothing: () => ({
              returning: async () => {
                if (data().staged.some(item => item.messageId === row.messageId)) return [];
                data().staged.push(row);
                return [{ messageId: row.messageId }];
              },
            }) }) }),
          };
        `,
        "drizzle-orm": `
          export const gt = (field, value) => row => row[field] > value;
          export const lte = (field, value) => row => row[field] <= value;
          export const and = (...tests) => row => tests.every(test => !test || test(row));
          export const asc = () => ({ direction: 1 });
          export const desc = () => ({ direction: -1 });
          export const eq = (field, value) => row => row[field] === value;
        `,
        "./gmailClient": `
          export class GmailHttpError extends Error { constructor(status) { super("HTTP"); this.status = status; } }
          export const getGmailProfile = async () => ({ emailAddress: globalThis.__catchUp.profile });
          export const listThreadMessages = async id => {
            globalThis.__catchUp.reads.push({ method: "GET", id });
            if (globalThis.__catchUp.fail === id) throw new GmailHttpError(globalThis.__catchUp.failStatus);
            return globalThis.__catchUp.messages[id] ?? [];
          };
        `,
        "./gmailWebhookHandler": `
          export const drainStagedGmailMessages = async () => ({
            processed: 0, skipped: 0, failed: 0, capped: false,
          });
        `,
      };
      builder.onResolve({ filter: /.*/ }, args =>
        Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args =>
        ({ contents: mocks[args.path], loader: "js" }));
    },
  }],
});
const { parseStoredThreadRecoveryRequest, recoverStoredOutreachThreads } =
  await import(pathToFileURL(target).href);

function reset() {
  globalThis.__catchUp = {
    accounts: [{ accountEmail: "managed@example.test" }],
    profile: "managed@example.test",
    threads: Array.from({ length: 12 }, (_, i) => ({
      threadId: `thread-${String(i).padStart(2, "0")}`,
      sentMessageId: `sent-${i}`,
    })),
    messages: {}, staged: [], reads: [],
  };
}

test("requires explicit confirmation and paired bounded cursor", () => {
  assert.equal(parseStoredThreadRecoveryRequest({}), null);
  assert.equal(parseStoredThreadRecoveryRequest({ confirm: "recover-stored-outreach-threads", after: "x" }), null);
  assert.equal(parseStoredThreadRecoveryRequest({ confirm: "recover-stored-outreach-threads", extra: true }), null);
  assert.equal(parseStoredThreadRecoveryRequest({ confirm: "recover-stored-outreach-threads", after: "\n", through: "z" }), null);
  assert.deepEqual(parseStoredThreadRecoveryRequest({ confirm: "recover-stored-outreach-threads" }),
    { after: undefined, through: undefined });
});

test("pages through known threads only, including archived old replies, without bodies in staging", async () => {
  reset();
  for (let i = 0; i < 12; i++) {
    const threadId = globalThis.__catchUp.threads[i].threadId;
    globalThis.__catchUp.messages[threadId] = [
      { id: `sent-${i}`, threadId, labelIds: ["SENT"] },
      { id: `reply-${i}`, threadId, labelIds: ["IMPORTANT"], body: "must never persist" },
      { id: `draft-${i}`, threadId, labelIds: ["DRAFT"] },
    ];
  }
  const first = await recoverStoredOutreachThreads({});
  assert.equal(first.inspectedThreads, 5);
  assert.equal(first.hasMoreThreads, true);
  assert.equal(first.through, "thread-11");
  assert.equal(globalThis.__catchUp.staged.length, 5);
  globalThis.__catchUp.threads.push({ threadId: "thread-99", sentMessageId: "new" });
  const second = await recoverStoredOutreachThreads({ after: first.nextAfter, through: first.through });
  const third = await recoverStoredOutreachThreads({ after: second.nextAfter, through: second.through });
  assert.equal(third.hasMoreThreads, false);
  assert.equal(third.inspectedThreads, 2);
  const replay = await recoverStoredOutreachThreads({ after: first.nextAfter, through: first.through });
  assert.equal(replay.stagedReferences, 0);
  assert.equal(globalThis.__catchUp.staged.length, 12);
  assert.ok(globalThis.__catchUp.staged.every(row =>
    row.status === "pending" && !Object.hasOwn(row, "body")));
  assert.ok(globalThis.__catchUp.reads.every(read => read.method === "GET" && read.id !== "thread-99"));
});

test("failed page leaves prior staged IDs for safe replay; deleted threads do not block progress", async () => {
  reset();
  globalThis.__catchUp.fail = "thread-02";
  globalThis.__catchUp.failStatus = 503;
  globalThis.__catchUp.messages["thread-00"] = [{ id: "reply-00", threadId: "thread-00", labelIds: [] }];
  await assert.rejects(recoverStoredOutreachThreads({}));
  assert.equal(globalThis.__catchUp.staged.length, 1);
  globalThis.__catchUp.failStatus = 404;
  const page = await recoverStoredOutreachThreads({});
  assert.equal(page.missingThreads, 1);
  assert.equal(page.stagedReferences, 0);
  assert.equal(globalThis.__catchUp.staged.length, 1);
  globalThis.__catchUp.profile = "different@example.test";
  await assert.rejects(recoverStoredOutreachThreads({}), /does not match/);
});

test.after(async () => { await rm(temp, { recursive: true, force: true }); });