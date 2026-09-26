import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const dir = await mkdtemp(path.join(os.tmpdir(), "chef-cleanup-"));
const output = path.join(dir, "cleanup.mjs");
const state = {
  queue: [], intents: [], referenced: new Set(), deleted: [],
  failures: new Set(), warnings: [],
};
globalThis.__chefCleanupTest = state;
await build({
  entryPoints: [path.resolve(import.meta.dirname, "chefPhotoCleanup.ts")],
  outfile: output, bundle: true, platform: "node", format: "esm",
  plugins: [{
    name: "chef-cleanup-mocks",
    setup(plugin) {
      plugin.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$|^node-cron$|chefObjectStorage$|\/logger$/ },
        (args) => ({ path: args.path, namespace: "mock" }));
      plugin.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
        loader: "js",
        contents: args.path === "@workspace/db" ? `
          const state=()=>globalThis.__chefCleanupTest;
          export const chefPhotoDeletionQueueTable={kind:"queue",objectPath:"objectPath",dueAt:"dueAt"};
          export const chefPhotoUploadIntentsTable={kind:"intents",id:"id",cleanupAfter:"cleanupAfter"};
          export const restaurantChefProfilesTable={restaurantId:"restaurantId",photoObjectPath:"photoObjectPath"};
          export const db={async transaction(callback){
            const tx={
              async execute(query){
                if(query.text.includes("FROM chef_photo_deletion_queue")) {
                  const row=state().queue.find(x=>x.dueAt<=query.values[0]);
                  return {rows:row?[{objectPath:row.objectPath}]:[]};
                }
                if(query.text.includes("FROM chef_photo_upload_intents")) {
                  const row=state().intents.find(x=>x.cleanupAfter<=query.values[0] &&
                    x.expiresAt<=query.values[1] && (!x.consumedAt || x.consumedAt<=query.values[2]));
                  return {rows:row?[{id:row.id,objectPath:row.objectPath}]:[]};
                }
                return {rows:[]};
              },
              select(){return {from(){return {where(condition){return {async limit(){
                return state().referenced.has(condition.value)?[{restaurantId:"owner"}]:[];
              }}}}}}},
              delete(table){return {where(condition){return {
                then(resolve){const rows=state()[table.kind]; const i=rows.findIndex(x=>x[condition.column]===condition.value);
                  if(i>=0) rows.splice(i,1); return Promise.resolve().then(resolve);}
              }}}},
              update(table){return {set(values){return {where(condition){
                const row=state()[table.kind].find(x=>x[condition.column]===condition.value);
                Object.assign(row,values); return Promise.resolve();
              }}}}},
            };
            return callback(tx);
          }};
        ` : args.path === "drizzle-orm" ? `
          export const eq=(column,value)=>({column,value});
          export const sql=(strings,...values)=>({text:strings.join("?"),values});
        ` : args.path === "node-cron" ? "export default {schedule(){return {}}};"
          : args.path.endsWith("chefObjectStorage") ? `
            export async function deleteChefObject(path){
              const s=globalThis.__chefCleanupTest;
              if(s.failures.has(path)) throw new Error("storage unavailable");
              s.deleted.push(path);
            }
          ` : `export const logger={warn(...args){globalThis.__chefCleanupTest.warnings.push(args)},error(){}};`,
      }));
    },
  }],
  logLevel: "silent",
});
const { cleanupChefPhotos } = await import(pathToFileURL(output).href);
const now = new Date("2026-09-26T12:00:00Z");
const reset = () => {
  state.queue = []; state.intents = []; state.referenced.clear();
  state.deleted = []; state.failures.clear(); state.warnings = [];
};

test("referenced paths are never deleted, including pending profiles", async () => {
  reset();
  state.queue.push({ objectPath: "pending", dueAt: new Date(0) });
  state.intents.push({ id: "1", objectPath: "approved", cleanupAfter: new Date(0),
    expiresAt: new Date(0), consumedAt: null });
  state.referenced.add("pending"); state.referenced.add("approved");
  await cleanupChefPhotos(now);
  assert.deepEqual(state.deleted, []);
  assert.equal(state.queue.length, 0);
  assert.equal(state.intents.length, 0);
});

test("expired unfinalised intents are removed, but recent consumed intents are retained", async () => {
  reset();
  state.intents.push(
    { id: "old", objectPath: "abandoned", cleanupAfter: new Date(0),
      expiresAt: new Date(0), consumedAt: null },
    { id: "new", objectPath: "finalising", cleanupAfter: new Date(0),
      expiresAt: new Date(0), consumedAt: new Date(now.getTime() - 60_000) },
  );
  await cleanupChefPhotos(now);
  assert.deepEqual(state.deleted, ["abandoned"]);
  assert.deepEqual(state.intents.map(x => x.id), ["new"]);
});

test("failed storage deletes remain queued for retry without stopping other work", async () => {
  reset();
  state.queue.push({ objectPath: "broken", dueAt: new Date(0) }, { objectPath: "good", dueAt: new Date(0) });
  state.failures.add("broken");
  await cleanupChefPhotos(now);
  assert.deepEqual(state.deleted, ["good"]);
  assert.equal(state.queue.length, 1);
  assert.equal(state.queue[0].dueAt.getTime(), now.getTime() + 60 * 60_000);
  assert.equal(state.warnings.length, 1);
  state.failures.clear();
  await cleanupChefPhotos(new Date(now.getTime() + 60 * 60_000));
  assert.deepEqual(state.deleted, ["good", "broken"]);
  assert.equal(state.queue.length, 0);
});

test.after(async () => {
  await rm(dir, { recursive: true, force: true });
  delete globalThis.__chefCleanupTest;
});