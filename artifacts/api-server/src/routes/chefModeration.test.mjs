import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import express from "express";
import { build } from "esbuild";

const dbMock = `
const table = (kind) => new Proxy({ kind }, {
  get(target, key) { return key === "kind" ? kind : { name: key }; },
});
export const restaurantChefProfilesTable = table("chef");
export const restaurantsTable = table("restaurants");
const state = () => globalThis.__chefModerationState;
const matches = (condition, row) => condition.op === "and"
  ? condition.conditions.every(part => matches(part, row))
  : (row[condition.column.name] instanceof Date && condition.value instanceof Date
    ? row[condition.column.name].getTime() === condition.value.getTime()
    : row[condition.column.name] === condition.value);
export const db = {
  select(selection) {
    return {
      from(table) { this.table = table; return this; },
      innerJoin() { this.joined = true; return this; },
      where(condition) { this.condition = condition; return this; },
      orderBy() { return this; },
      limit(count) { this.count = count; return this; },
      then(resolve, reject) {
        try {
          let rows = state()[this.table.kind].filter(row => !this.condition || matches(this.condition, row));
          if (this.count) rows = rows.slice(0, this.count);
          resolve(rows.map(row => selection
            ? Object.fromEntries(Object.entries(selection).map(([key, col]) =>
              [key, key === "restaurantName" ? state().restaurants.find(r => r.placeId === row.restaurantId)?.name : row[col.name]]))
            : { ...row }));
        } catch (error) { reject(error); }
      },
    };
  },
  update(table) {
    return {
      set(values) {
        return {
          where(condition) {
            return {
              async returning() {
                const row = state()[table.kind].find(candidate => matches(condition, candidate));
                if (!row) return [];
                Object.assign(row, values);
                return [{ ...row }];
              },
            };
          },
        };
      },
    };
  },
};
`;
const conditionsMock = `
export const eq = (column, value) => ({ op: "eq", column, value });
export const and = (...conditions) => ({ op: "and", conditions });
export const asc = (column) => column;
`;

const directory = await mkdtemp(path.join(os.tmpdir(), "chef-moderation-"));
async function bundle(source, name) {
  const outfile = path.join(directory, name + ".mjs");
  await build({
    entryPoints: [path.resolve(import.meta.dirname, source)],
    outfile, bundle: true, format: "esm", platform: "node",
    plugins: [{
      name: "chef-moderation-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^express$/ }, () => ({
          path: fileURLToPath(import.meta.resolve("express")), external: true,
        }));
        builder.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$|adminOnly$|chefObjectStorage$|chefPhotoLifecycle$/ },
          (args) => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: args.path === "@workspace/db" ? dbMock
            : args.path === "drizzle-orm" ? conditionsMock
            : args.path.endsWith("adminOnly")
              ? 'export function adminOnly(req,res,next){if(req.headers["x-test-admin"]==="yes")next();else res.status(403).json({error:"Forbidden"});}'
              : args.path.endsWith("chefObjectStorage")
                ? 'export async function streamChefObject(path,res){globalThis.__chefModerationState.streams.push(path);res.type("image/png").send("photo bytes");}'
                : `export async function removeChefProfile(id, expectedRevision) {
                     const rows=globalThis.__chefModerationState.chef;
                     const index=rows.findIndex(row=>row.restaurantId===id && (!expectedRevision ||
                       (row.moderationStatus==="pending" && row.updatedAt.getTime()===expectedRevision.getTime())));
                     if(index>=0) rows.splice(index,1);
                     return index>=0;
                   }
                   export async function saveChefProfile(){throw new Error("not used");}`,
          loader: "js",
        }));
      },
    }],
  });
  return (await import(pathToFileURL(outfile).href)).default;
}

const adminRouter = await bundle("adminChef.ts", "admin");
const publicRouter = await bundle("chefStorage.ts", "public");
const app = express();
app.use(express.json());
app.use("/api/admin", adminRouter);
app.use("/api", publicRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
const id = "00000000-0000-0000-0000-000000000001";
const photo = `/objects/chef/${id}`;

function reset(status = "pending") {
  globalThis.__chefModerationState = {
    restaurants: [{ placeId: "place-1", name: "Example Bistro" }],
    chef: [{
      restaurantId: "place-1", name: "A Chef", bio: "A biography",
      philosophy: "A philosophy", signatureDishes: ["A dish"], awards: ["An award"],
      awardEvidenceUrls: ["https://example.test/award"],
      dishEvidenceUrls: ["https://example.test/dish"],
      photoObjectPath: photo, photoMimeType: "image/png", photoSizeBytes: 12,
      moderationStatus: status, rejectionReason: null, reviewedBy: null,
      verifiedAt: null, updatedAt: new Date("2026-09-25T10:00:00Z"),
    }],
    streams: [],
  };
}

async function request(pathname, options = {}) {
  const response = await fetch(base + pathname, options);
  return { status: response.status, body: response.headers.get("content-type")?.includes("json")
    ? await response.json() : await response.text() };
}
const admin = { "x-test-admin": "yes" };
const reviewHeaders = () => ({ ...admin, "x-chef-review-revision": globalThis.__chefModerationState.chef[0].updatedAt.toISOString() });
const publicPhoto = () => request(`/storage/objects/chef/${id}`);

test("pending and rejected photos are private; the admin list returns the review page's response shape", async () => {
  reset();
  assert.equal((await publicPhoto()).status, 404);
  assert.deepEqual(globalThis.__chefModerationState.streams, []);
  assert.equal((await request("/admin/chef-profiles/pending")).status, 403);
  const pending = await request("/admin/chef-profiles/pending", { headers: admin });
  assert.equal(pending.status, 200);
  assert.equal(pending.body.success, true);
  assert.equal(pending.body.profiles.length, 1);
  assert.deepEqual(Object.keys(pending.body.profiles[0]).sort(), [
    "restaurantId", "restaurantName", "name", "bio", "philosophy",
    "awards", "awardEvidenceUrls", "signatureDishes", "dishEvidenceUrls",
    "photoObjectPath", "photoMimeType", "photoSizeBytes", "moderationStatus",
    "rejectionReason", "updatedAt",
  ].sort());
  assert.equal(pending.body.profiles[0].restaurantName, "Example Bistro");
  assert.equal(pending.body.profiles[0].updatedAt, "2026-09-25T10:00:00.000Z");
  assert.equal((await request("/admin/chef-profiles/place-1/photo", { headers: admin })).status, 200);
  assert.equal((await request("/admin/chef-profiles/place-1/photo")).status, 403);
  const rejected = await request("/admin/chef-profiles/place-1/reject", {
    method: "POST", headers: { ...reviewHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ reason: "Evidence requires additional verification." }),
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.profile.moderationStatus, "rejected");
  assert.equal(rejected.body.profile.verifiedAt, null);
  assert.equal((await publicPhoto()).status, 404);
  assert.deepEqual((await request("/admin/chef-profiles/pending", { headers: admin })).body.profiles, []);
});

test("approval timestamps a pending profile; rejection and admin removal revoke public photos immediately", async () => {
  reset();
  const approved = await request("/admin/chef-profiles/place-1/approve", {
    method: "POST", headers: reviewHeaders(),
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.profile.moderationStatus, "approved");
  assert.ok(Date.now() - Date.parse(approved.body.profile.verifiedAt) < 60_000);
  assert.equal(approved.body.profile.reviewedBy, "admin");
  assert.equal((await publicPhoto()).status, 200);
  assert.deepEqual(globalThis.__chefModerationState.streams, [photo]);
  assert.equal((await request("/admin/chef-profiles/place-1/approve", {
    method: "POST", headers: reviewHeaders(),
   })).status, 409, "an approved profile cannot be re-approved");

  const rejected = await request("/admin/chef-profiles/place-1/reject", {
    method: "POST", headers: { ...reviewHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ reason: "Withdrawn" }),
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, "CHEF_REVIEW_STALE");
  assert.equal((await publicPhoto()).status, 200);
  reset("approved");
  assert.equal((await request("/admin/chef-profiles/place-1", {
    method: "DELETE", headers: reviewHeaders(),
  })).status, 409);
  assert.equal((await publicPhoto()).status, 200);
  reset();
  assert.equal((await request("/admin/chef-profiles/place-1", {
    method: "DELETE", headers: reviewHeaders(),
  })).status, 200);
  assert.equal((await publicPhoto()).status, 404);
  assert.equal((await request("/admin/chef-profiles/place-1/photo", { headers: admin })).status, 404);
  assert.deepEqual(globalThis.__chefModerationState.streams, []);
});

test("two reviewers cannot decide the same pending chef profile twice", async () => {
  for (const firstAction of ["approve", "reject", "remove"]) {
    for (const secondAction of ["approve", "reject", "remove"]) {
      reset();
      const revision = reviewHeaders();
      const decide = (action) => request(`/admin/chef-profiles/place-1${action === "remove" ? "" : `/${action}`}`, {
        method: action === "remove" ? "DELETE" : "POST",
        headers: { ...revision, "content-type": "application/json" },
        ...(action === "reject" ? { body: JSON.stringify({ reason: "Needs evidence" }) } : {}),
      });
      const first = await decide(firstAction);
      const second = await decide(secondAction);
      assert.equal(first.status, 200, firstAction);
      assert.equal(second.status, 409, `${firstAction} then ${secondAction}`);
      assert.equal(second.body.code, "CHEF_REVIEW_STALE");
      assert.equal(globalThis.__chefModerationState.chef[0]?.moderationStatus,
        firstAction === "remove" ? undefined : firstAction === "approve" ? "approved" : "rejected");
      assert.deepEqual((await request("/admin/chef-profiles/pending", { headers: admin })).body.profiles, []);
    }
  }
});

test("changed pending content and a rejection followed by resubmission invalidate every old decision", async () => {
  for (const change of ["edit", "resubmit"]) {
    for (const action of ["approve", "reject", "remove"]) {
      reset();
      const oldRevision = reviewHeaders();
      if (change === "resubmit") {
        const rejected = await request("/admin/chef-profiles/place-1/reject", {
          method: "POST", headers: { ...oldRevision, "content-type": "application/json" },
          body: JSON.stringify({ reason: "Needs evidence" }),
        });
        assert.equal(rejected.status, 200);
      }
      const current = globalThis.__chefModerationState.chef[0];
      current.name = "Changed chef details";
      current.moderationStatus = "pending";
      current.updatedAt = new Date(current.updatedAt.getTime() + 1);
      const result = await request(`/admin/chef-profiles/place-1${action === "remove" ? "" : `/${action}`}`, {
        method: action === "remove" ? "DELETE" : "POST",
        headers: { ...oldRevision, "content-type": "application/json" },
        ...(action === "reject" ? { body: JSON.stringify({ reason: "Old details" }) } : {}),
      });
      assert.equal(result.status, 409, `${change} then ${action}`);
      assert.equal(result.body.code, "CHEF_REVIEW_STALE");
      assert.equal(current.moderationStatus, "pending");
      assert.equal(current.name, "Changed chef details");
      assert.equal((await request("/admin/chef-profiles/pending", { headers: admin })).body.profiles[0].name, "Changed chef details");
    }
  }
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});