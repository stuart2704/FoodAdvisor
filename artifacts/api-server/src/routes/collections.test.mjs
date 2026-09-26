import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const dbMock = String.raw`
function table(source) {
  return new Proxy({ source }, {
    get(target, key) {
      return key === "source" ? source : { source, key };
    },
  });
}
export const restaurantsTable = table("restaurants");
export const restaurantCollectionsTable = table("collections");
export const restaurantCollectionMembersTable = table("members");
export const restaurantOffersTable = table("offers");
export const restaurantEventsTable = table("events");
export const restaurantMenuItemsTable = table("menu");
export const restaurantChefProfilesTable = table("chef");

const state = () => globalThis.__collectionTestState;
const value = (expression, row) =>
  expression?.source ? row[expression.source]?.[expression.key] : expression;
function matches(condition, row) {
  if (!condition) return true;
  if (condition.op === "and") return condition.conditions.every((part) => matches(part, row));
  if (condition.op === "eq") return value(condition.column, row) === value(condition.expected, row);
  if (condition.op === "inArray") {
    const candidates = Array.isArray(condition.expected)
      ? condition.expected : condition.expected.run().map((item) => Object.values(item)[0]);
    return candidates.includes(value(condition.column, row));
  }
  if (condition.op === "gte") return value(condition.column, row) >= condition.expected;
  if (condition.op === "lte") return value(condition.column, row) <= condition.expected;
  throw new Error("Unexpected condition " + condition.op);
}
function query(selection) {
  let source, condition, order = [], joins = [], limit;
  const chain = {
    from(table) { source = table.source; return chain; },
    innerJoin(table, on) { joins.push({ table: table.source, on }); return chain; },
    where(next) { condition = next; return chain; },
    orderBy(...next) { order = next; return chain; },
    limit(next) { limit = next; return chain; },
    run() {
      let rows = state()[source].map((item) => ({ [source]: item }));
      for (const join of joins) {
        rows = rows.flatMap((row) => state()[join.table]
          .map((item) => ({ ...row, [join.table]: item }))
          .filter((joined) => matches(join.on, joined)));
      }
      rows = rows.filter((row) => matches(condition, row));
      rows.sort((a, b) => {
        for (const expression of order) {
          const left = value(expression, a);
          const right = value(expression, b);
          const comparison = left < right ? -1 : left > right ? 1 : 0;
          if (comparison) return comparison;
        }
        return 0;
      });
      if (limit !== undefined) rows = rows.slice(0, limit);
      return rows.map((row) => selection
        ? Object.fromEntries(Object.entries(selection).map(([key, column]) => [key, value(column, row)]))
        : { ...row[source] });
    },
    then(resolve, reject) {
      try { return Promise.resolve(this.run()).then(resolve, reject); }
      catch (error) { return Promise.reject(error).then(resolve, reject); }
    },
  };
  return chain;
}
function mutate(operation, table) {
  let patch, condition;
  const chain = {
    values(next) { patch = next; return chain; },
    set(next) { patch = next; return chain; },
    where(next) { condition = next; return chain; },
    then(resolve, reject) {
      try {
        const rows = state()[table.source];
        if (operation === "insert") {
          for (const item of Array.isArray(patch) ? patch : [patch]) {
            rows.push({ ...item, updatedAt: new Date("2026-09-25T00:00:00Z") });
          }
        } else {
          const removed = [];
          for (const row of rows.filter((item) => matches(condition, { [table.source]: item }))) {
            if (operation === "delete") removed.push(row);
            else Object.assign(row, patch);
          }
          if (operation === "delete") {
            state()[table.source] = rows.filter((row) => !removed.includes(row));
            if (table.source === "collections") {
              state().members = state().members.filter((row) =>
                !removed.some((collection) => collection.id === row.collectionId));
            }
          }
        }
        return Promise.resolve().then(resolve, reject);
      } catch (error) { return Promise.reject(error).then(resolve, reject); }
    },
  };
  return chain;
}
export const db = {
  select: (selection) => query(selection),
  insert: (table) => mutate("insert", table),
  update: (table) => mutate("update", table),
  delete: (table) => mutate("delete", table),
  async transaction(callback) {
    const snapshot = structuredClone(state());
    try { return await callback(db); }
    catch (error) { globalThis.__collectionTestState = snapshot; throw error; }
  },
};
`;

const ormMock = String.raw`
export const eq = (column, expected) => ({ op: "eq", column, expected });
export const and = (...conditions) => ({ op: "and", conditions });
export const inArray = (column, expected) => ({ op: "inArray", column, expected });
export const asc = (column) => column;
export const gte = (column, expected) => ({ op: "gte", column, expected });
export const lte = (column, expected) => ({ op: "lte", column, expected });
`;
const expressMock = String.raw`
export function Router() {
  const router = { stack: [] };
  for (const method of ["get", "post", "patch", "put", "delete"]) {
    router[method] = (path, ...handles) => {
      router.stack.push({ method, path, handles });
      return router;
    };
  }
  return router;
}
`;
const rateLimitMock = `export default () => (_req, _res, next) => next();`;
const clerkMock = `export const getAuth = (req) => req.auth ?? { userId: null };`;

const directory = await mkdtemp(path.join(os.tmpdir(), "collection-routes-"));
async function bundle(entry, output) {
  await build({
    entryPoints: [path.resolve(import.meta.dirname, entry)],
    outfile: path.join(directory, output),
    bundle: true,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "collection-fixture",
      setup(builder) {
        const mocks = new Map([
          ["@workspace/db", dbMock], ["drizzle-orm", ormMock],
          ["express", expressMock], ["express-rate-limit", rateLimitMock],
          ["@clerk/express", clerkMock],
        ]);
        builder.onResolve({ filter: /^@workspace\/db$|^drizzle-orm$|^express$|^express-rate-limit$|^@clerk\/express$/ },
          (args) => ({ path: args.path, namespace: "collection-fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "collection-fixture" },
          (args) => ({ contents: mocks.get(args.path), loader: "js" }));
      },
    }],
    logLevel: "silent",
  });
  return import(pathToFileURL(path.join(directory, output)).href);
}

let router, getRestaurantProfile;
try {
  [{ default: router }, { getRestaurantProfile }] = await Promise.all([
    bundle("collections.ts", "collections.mjs"),
    bundle("../services/restaurantProfileEngine.ts", "profile.mjs"),
  ]);
} catch (error) {
  await rm(directory, { recursive: true, force: true });
  throw error;
}
test.after(() => rm(directory, { recursive: true, force: true }));

const restaurants = [
  { placeId: "paris-1", name: "Chez A", city: "Paris", slug: "chez-a", cuisineTags: ["French"], rating: 4.7, premium: false, published: true },
  { placeId: "paris-2", name: "Chez B", city: "Paris", slug: "chez-b", cuisineTags: ["Bistro"], rating: 4.2, premium: true, published: true },
  { placeId: "lyon-1", name: "Lyon Cafe", city: "Lyon", slug: "lyon-cafe", cuisineTags: [], rating: null, premium: false, published: true },
  { placeId: "hidden-1", name: "Hidden", city: "Paris", slug: "hidden", cuisineTags: [], rating: null, premium: false, published: false },
];
const body = {
  title: "Paris Picks", description: "Two good places", city: "Paris",
  restaurantIds: ["paris-2", "paris-1"],
};
const curator = { userId: "curator-a", sessionClaims: { public_metadata: { role: "curator" } } };
const other = { userId: "curator-b", sessionClaims: { role: "curator" } };
const admin = { userId: "admin-user", sessionClaims: { role: "admin" } };
test.beforeEach(() => {
  globalThis.__collectionTestState = {
    restaurants: structuredClone(restaurants),
    collections: [], members: [], offers: [], events: [], menu: [], chef: [],
  };
});

async function request(method, route, { auth, session, body: input, params = {}, query = {} } = {}) {
  const layer = router.stack.find((item) => item.method === method && item.path === route);
  assert.ok(layer, `${method} ${route} is registered`);
  const headers = {};
  let status = 200, data;
  const res = {
    locals: {},
    set(name, value) { headers[name.toLowerCase()] = value; return this; },
    setHeader(name, value) { headers[name.toLowerCase()] = value; return this; },
    status(code) { status = code; return this; },
    json(value) { data = value; return this; },
    send() { return this; },
  };
  const req = { auth, session, body: input, params, query, log: { error() {} } };
  for (const handle of layer.handles) {
    let next = false;
    await handle(req, res, () => { next = true; });
    if (!next) break;
  }
  return { status, data, headers };
}

const create = (auth = curator, input = body) =>
  request("post", "/collections", { auth, body: input });
const edit = (id, auth, input) =>
  request("patch", "/collections/:id", { auth, params: { id }, body: input });
const reorder = (id, auth, restaurantIds) =>
  request("put", "/collections/:id/restaurants", { auth, params: { id }, body: { restaurantIds } });
const remove = (id, auth) =>
  request("delete", "/collections/:id", { auth, params: { id } });

test("signed-out and ordinary accounts cannot create, edit, reorder or delete collections", async () => {
  const created = await create();
  const id = created.data.data.id;
  const snapshot = structuredClone(globalThis.__collectionTestState);
  for (const auth of [undefined, { userId: "diner", sessionClaims: { role: "user" } }]) {
    for (const result of [
      await request("post", "/collections", { auth, body }), await edit(id, auth, { title: "Hacked" }),
      await reorder(id, auth, ["paris-1"]), await remove(id, auth),
      await request("get", "/collections/manage", { auth }),
    ]) {
      assert.equal(result.status, 403);
      assert.equal(result.headers["cache-control"], "no-store");
    }
  }
  assert.deepEqual(globalThis.__collectionTestState, snapshot);
});

test("one curator cannot edit, reorder, delete or manage another's collection; admin can edit", async () => {
  const id = (await create()).data.data.id;
  assert.equal((await edit(id, other, { title: "Stolen" })).status, 404);
  assert.equal((await reorder(id, other, ["paris-1"])).status, 404);
  assert.equal((await remove(id, other)).status, 404);
  assert.deepEqual((await request("get", "/collections/manage", { auth: other })).data.data, []);
  assert.equal(globalThis.__collectionTestState.collections[0].title, body.title);
  assert.equal((await edit(id, admin, { title: "Admin Picks" })).status, 200);
  assert.equal(globalThis.__collectionTestState.collections[0].curatorUserId, curator.userId);
  const sessionAdmin = await request("patch", "/collections/:id", {
    session: { admin: true }, params: { id }, body: { title: "Session admin picks" },
  });
  assert.equal(sessionAdmin.status, 200);
  assert.equal(globalThis.__collectionTestState.collections[0].curatorUserId, curator.userId);
});

test("creation rejects missing, unpublished, duplicate and cross-city restaurant IDs", async () => {
  for (const restaurantIds of [
    ["missing"], ["hidden-1"], ["paris-1", "paris-1"], ["paris-1", "lyon-1"],
  ]) {
    assert.equal((await create(curator, { ...body, restaurantIds })).status, 400);
  }
  assert.deepEqual(globalThis.__collectionTestState.collections, []);
  assert.deepEqual(globalThis.__collectionTestState.members, []);
});

test("editing and reordering reject invalid memberships without changing saved data", async () => {
  const id = (await create()).data.data.id;
  const snapshot = structuredClone(globalThis.__collectionTestState);
  for (const restaurantIds of [["missing"], ["paris-1", "paris-1"], ["lyon-1"], ["hidden-1"]]) {
    assert.equal((await edit(id, curator, { restaurantIds })).status, 400);
    assert.equal((await reorder(id, curator, restaurantIds)).status, 400);
  }
  assert.equal((await edit(id, curator, { city: "Lyon" })).status, 400);
  assert.deepEqual(globalThis.__collectionTestState, snapshot);
});

test("curator can create, edit, reorder and delete; public summaries resolve ordered restaurants without owner IDs", async () => {
  const created = await create();
  assert.equal(created.status, 201);
  const id = created.data.data.id;
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal(created.data.data.curatorUserId, curator.userId);
  assert.deepEqual(created.data.data.restaurants.map((item) => item.id), body.restaurantIds);
  assert.deepEqual(globalThis.__collectionTestState.members.map((item) => item.position), [0, 1]);

  const updated = await edit(id, curator, { title: "New title", description: "New description" });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.data.title, "New title");
  assert.equal(updated.data.data.description, "New description");
  const reordered = await reorder(id, curator, ["paris-1", "paris-2"]);
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.data.data.restaurants.map((item) => item.id), ["paris-1", "paris-2"]);
  assert.deepEqual(globalThis.__collectionTestState.members.map((item) => item.position), [0, 1]);
  const shortened = await edit(id, curator, { restaurantIds: ["paris-1"] });
  assert.equal(shortened.status, 200);
  assert.deepEqual(shortened.data.data.restaurants.map((item) => item.id), ["paris-1"]);
  assert.deepEqual(globalThis.__collectionTestState.members.map((item) => item.position), [0]);
  assert.equal((await reorder(id, curator, ["paris-2", "paris-1"])).status, 200);
  const publicResult = await request("get", "/collections", { query: { city: "Paris" } });
  assert.equal(publicResult.status, 200);
  assert.equal(publicResult.headers["cache-control"], "public, max-age=60");
  assert.deepEqual(publicResult.data.data.map((item) => item.title), ["New title"]);
  assert.equal("curatorUserId" in publicResult.data.data[0], false);
  assert.deepEqual(publicResult.data.data[0].restaurants.map(({ id, slug, name, city, cuisine, rating, premium }) =>
    ({ id, slug, name, city, cuisine, rating, premium })), [
    { id: "paris-2", slug: "chez-b", name: "Chez B", city: "Paris", cuisine: "Bistro", rating: 4.2, premium: true },
    { id: "paris-1", slug: "chez-a", name: "Chez A", city: "Paris", cuisine: "French", rating: 4.7, premium: false },
  ]);
  assert.deepEqual((await request("get", "/collections", { query: { city: "Lyon" } })).data.data, []);
  assert.equal((await remove(id, curator)).status, 204);
  assert.deepEqual(globalThis.__collectionTestState.members, []);
  assert.deepEqual((await request("get", "/collections")).data.data, []);
});

test("restaurant profiles include stored collections and their ordered published members", async () => {
  const first = (await create()).data.data.id;
  const second = (await create(curator, { ...body, title: "Another list", restaurantIds: ["paris-1"] })).data.data.id;
  // Supply profile fields that aren't needed by the collection route.
  Object.assign(globalThis.__collectionTestState.restaurants[0], {
    claimedAt: null, claimStatus: null, sourceName: "google", sourceAttribution: null,
    country: "France", currency: "EUR", types: [], priceLevel: null, popularity: 0,
    qualificationScore: 0, aiRelevanceBoost: 0, openingHours: [], address: "1 Rue A",
  });
  const profile = await getRestaurantProfile("paris-1");
  assert.deepEqual(profile.collections, [
    { id: second, title: "Another list", description: body.description, city: "Paris", restaurants: ["paris-1"] },
    { id: first, title: body.title, description: body.description, city: "Paris", restaurants: ["paris-2", "paris-1"] },
  ]);
  assert.equal(await getRestaurantProfile("hidden-1"), null);
});

test("public collection summaries and profiles omit members unpublished after creation", async () => {
  const id = (await create()).data.data.id;
  globalThis.__collectionTestState.restaurants.find((row) => row.placeId === "paris-2").published = false;
  const summary = await request("get", "/collections");
  assert.equal(summary.status, 200);
  assert.deepEqual(summary.data.data[0].restaurants.map((row) => row.id), ["paris-1"]);
  Object.assign(globalThis.__collectionTestState.restaurants[0], {
    claimedAt: null, claimStatus: null, sourceName: "google", sourceAttribution: null,
    country: "France", currency: "EUR", types: [], priceLevel: null, popularity: 0,
    qualificationScore: 0, aiRelevanceBoost: 0, openingHours: [], address: "1 Rue A",
  });
  assert.deepEqual((await getRestaurantProfile("paris-1")).collections, [{
    id, title: body.title, description: body.description, city: "Paris",
    restaurants: ["paris-1"],
  }]);
});