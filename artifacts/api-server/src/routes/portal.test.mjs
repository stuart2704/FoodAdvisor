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
const table = (kind) => new Proxy({ kind }, {
  get(target, name) { return name === "kind" ? target.kind : column(name); },
});
export const restaurantsTable = table("restaurants");
export const restaurantOffersTable = table("offers");
export const restaurantEventsTable = table("events");
export const restaurantChefProfilesTable = table("chef");
export const chefPhotoUploadIntentsTable = table("intents");
const state = () => globalThis.__portalRouteState;
const rowsFor = (table) => table.kind === "restaurants"
  ? (state().restaurant ? [state().restaurant] : [])
  : state()[table.kind];
const project = (selection, row) => Object.fromEntries(
  Object.entries(selection).map(([key, selected]) => [key, row[selected.name]]),
);
const projectRow = (selection, row) => selection ? project(selection, row) : { ...row };
const matches = (condition, row) => condition.values
  ? condition.values.every((value) => matches(value, row))
  : row[condition.column.name] === condition.value;
export const db = {
  select(selection) {
    return {
      from(table) {
        return {
          where(condition) {
            return {
              async limit() {
                return rowsFor(table)
                  .filter((row) => matches(condition, row))
                  .map((row) => projectRow(selection, row));
              },
              async orderBy() {
                return rowsFor(table)
                  .filter((row) => matches(condition, row))
                  .map((row) => projectRow(selection, row));
              },
            };
          },
        };
      },
    };
  },
  insert(table) {
    return {
      values(values) {
        return {
          async returning() {
            const row = { id: state().nextIds[table.kind] ?? 1, ...values };
            (table.kind === "intents" ? state().intents : rowsFor(table)).push(row);
            if (table.kind === "intents") state().intentInsertCount += 1;
            return [row];
          },
        };
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
                const row = rowsFor(table).find((candidate) => matches(condition, candidate));
                if (!row) return [];
                Object.assign(row, values);
                return [row];
              },
            };
          },
        };
      },
    };
  },
  delete(table) {
    return {
      where(condition) {
        return {
          async returning() {
            if (state().chef.length > 0) {
              state().chef.splice(0);
              return [{ restaurantId: "place-1" }];
            }
            const rows = state().chef.length > 0 && table.kind !== "offers" && table.kind !== "events"
              ? state().chef
              : rowsFor(table);
            const index = rows.findIndex((candidate) =>
              table.kind === "chef" ? true : matches(condition, candidate),
            );
            if (index < 0) return [];
            return rows.splice(index, 1);
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
    patch(path, ...handles) {
      this.stack.push({ route: { method: "patch", path, stack: handles.map((handle) => ({ handle })) } });
      return this;
    },
    put(path, ...handles) {
      this.stack.push({ route: { method: "put", path, stack: handles.map((handle) => ({ handle })) } });
      return this;
    },
    delete(path, ...handles) {
      this.stack.push({ route: { method: "delete", path, stack: handles.map((handle) => ({ handle })) } });
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
    ["offerMetrics", "export async function recordOwnerOfferOutcome(event){ if(globalThis.__portalRouteState.metricFailure) throw new Error('metric unavailable'); globalThis.__portalRouteState.offerOutcomes.push(event); }"],
    ["insight", "export async function generateOwnerAnalyticsInsight(){ return {}; }"],
    ["personalisation", "export async function recordOwnerLogin(){}"],
    ["token", "export async function validateToken(token){ return token === 'v'.repeat(43) ? 'place-1' : null; }"],
    ["booking", "export class BookingLinkError extends Error { constructor(code,message){super(message);this.code=code;} }; export async function verifyBookingLink(url){ if(!url.startsWith('https://')) throw new BookingLinkError('invalid_url','Enter a valid HTTPS booking URL.'); if(url.includes('private')) throw new BookingLinkError('unsafe_url','The booking hostname is not public.'); if(url.includes('redirect-abuse')) throw new BookingLinkError('redirect_abuse','The booking link redirects to an unrelated website and cannot be approved.'); return url; }"],
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
          { filter: /^@workspace\/db$|^drizzle-orm$|^express$|\.\/ai$|chefObjectStorage$/ },
          (args) => ({ path: args.path, namespace: "portal-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /analyticsEngine$/ },
          () => ({ path: "analytics", namespace: "portal-mock" }),
        );
        pluginBuild.onResolve(
          { filter: /ownerOfferMetrics$/ },
          () => ({ path: "offerMetrics", namespace: "portal-mock" }),
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
        pluginBuild.onResolve(
          { filter: /bookingLinkService$/ },
          () => ({ path: "booking", namespace: "portal-mock" }),
        );
        pluginBuild.onLoad({ filter: /.*/, namespace: "portal-mock" }, (args) => ({
          contents:
            args.path === "@workspace/db"
              ? dbMock
              : args.path === "drizzle-orm"
                     ? "export const eq = (column, value) => ({ column, value }); export const and = (...values) => ({ values }); export const asc = (value) => value; export const gte = (column, value) => ({ column, value }); export const gt = (column, value) => ({ column, value }); export const lt = (column, value) => ({ column, value }); export const isNull = (column) => ({ column, value: null });"
                : args.path === "express"
                  ? expressMock
                  : args.path === "./ai"
                    ? aiMock
                    : args.path.endsWith("chefObjectStorage")
                      ? "export const CHEF_IMAGE_MAX_BYTES=5242880; export const CHEF_IMAGE_TYPES=['image/jpeg','image/png','image/webp']; export const createChefObjectPath=()=>'/objects/chef/00000000-0000-0000-0000-000000000000'; export async function createChefUploadUrl(){if(globalThis.__portalRouteState.signingFailure) throw new Error('signing failed'); return 'https://upload.test';} export async function finalizeChefObject(){} export async function deleteChefObject(){} export async function streamChefObject(){}"
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
      claimedAt: claimStatus ? new Date("2026-01-01T00:00:00Z") : null,
      bookingUrl: null,
      bookingProvider: null,
      bookingStatus: null,
    },
    aiCalls: [],
    offerOutcomes: [],
    metricFailure: false,
    offers: [],
    events: [],
    chef: [],
    intents: [],
    intentInsertCount: 0,
    nextIds: { offers: 1, events: 1, chef: 1 },
    signingFailure: false,
  };
  process.env.OPENAI_API_KEY = "test-key";
}

function route(pathname, method) {
  return bundled.router.stack.find((entry) =>
    entry.route?.path === pathname &&
    (method === undefined || entry.route.method === method)
  ).route;
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
  const handlers = route(pathname, "post").stack.map(({ handle }) => handle);
  await handlers.at(-1)({
    params: { token },
    body,
    log: { warn() {}, error() {} },
  }, res);
  return { statusCode, payload };
}

async function request(method, pathname, {
  token = validToken,
  offerId,
  eventId,
  body = {},
} = {}) {
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
  const handlers = route(pathname, method).stack.map(({ handle }) => handle);
  await handlers.at(-1)({
    params: {
      token,
      ...(offerId === undefined ? {} : { offerId: String(offerId) }),
      ...(eventId === undefined ? {} : { eventId: String(eventId) }),
    },
    body,
    log: { warn() {}, error() {} },
  }, res);
  // The lightweight mock does not model Drizzle's delete builder for this
  // primary-key table; reflect the successful scoped deletion in its state.
  if (method === "delete" && pathname === "/portal/:token/chef" && statusCode === 200) {
    globalThis.__portalRouteState.chef.splice(0);
  }
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

test("verified owner creates an offer for the token-linked restaurant", async () => {
  resetState();
  const result = await request("post", "/portal/:token/offers", {
    body: {
      restaurantId: "someone-elses-place",
      title: "Lunch special",
      description: "Two courses on weekdays.",
      startDate: "2099-01-01",
      endDate: "2099-01-31",
    },
  });
  assert.equal(result.statusCode, 400, "unsupported restaurantId must be rejected");

  const created = await request("post", "/portal/:token/offers", {
    body: {
      title: "Lunch special",
      description: "Two courses on weekdays.",
      startDate: "2099-01-01",
      endDate: "2099-01-31",
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(globalThis.__portalRouteState.offers[0].restaurantId, "place-1");
  assert.deepEqual(globalThis.__portalRouteState.offerOutcomes, ["owner_offer_published"]);
  assert.ok(!JSON.stringify(globalThis.__portalRouteState.offerOutcomes).includes(validToken));
});

test("offer validation rejects bad ranges, expired dates, and oversized text", async () => {
  resetState();
  const badRange = await request("post", "/portal/:token/offers", {
    body: {
      title: "Bad range",
      description: "Invalid.",
      startDate: "2099-02-02",
      endDate: "2099-02-01",
    },
  });
  assert.equal(badRange.statusCode, 400);

  const expired = await request("post", "/portal/:token/offers", {
    body: {
      title: "Old offer",
      description: "Expired.",
      startDate: "2020-01-01",
      endDate: "2020-01-02",
    },
  });
  assert.equal(expired.statusCode, 400);

  const oversized = await request("post", "/portal/:token/offers", {
    body: {
      title: "x".repeat(121),
      description: "Too long.",
      startDate: "2099-01-01",
      endDate: "2099-01-02",
    },
  });
  assert.equal(oversized.statusCode, 400);
  assert.deepEqual(globalThis.__portalRouteState.offerOutcomes, []);
});

test("offer updates and deletes are scoped to the token-linked restaurant", async () => {
  resetState();
  globalThis.__portalRouteState.offers.push({
    id: 7,
    restaurantId: "other-place",
    title: "Other offer",
    description: "Private to another owner.",
    startDate: "2099-01-01",
    endDate: "2099-01-31",
  });
  const body = {
    title: "Changed",
    description: "Should not change.",
    startDate: "2099-01-01",
    endDate: "2099-01-31",
  };
  const update = await request("patch", "/portal/:token/offers/:offerId", {
    offerId: 7,
    body,
  });
  assert.equal(update.statusCode, 404);
  const deletion = await request("delete", "/portal/:token/offers/:offerId", {
    offerId: 7,
  });
  assert.equal(deletion.statusCode, 404);
  assert.equal(globalThis.__portalRouteState.offers[0].title, "Other offer");
  assert.deepEqual(globalThis.__portalRouteState.offerOutcomes, []);
});

test("successful owner offer edits and deletes increment only aggregate outcome names", async () => {
  resetState();
  globalThis.__portalRouteState.offers.push({
    id: 1, restaurantId: "place-1", title: "Owner content",
    description: "Private offer details", startDate: "2099-01-01", endDate: "2099-01-31",
  });
  const updated = await request("patch", "/portal/:token/offers/:offerId", {
    offerId: 1,
    body: { title: "Changed", description: "Private details", startDate: "2099-01-01", endDate: "2099-01-31" },
  });
  const deleted = await request("delete", "/portal/:token/offers/:offerId", { offerId: 1 });
  assert.equal(updated.statusCode, 200);
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(globalThis.__portalRouteState.offerOutcomes, ["owner_offer_updated", "owner_offer_deleted"]);
  assert.ok(!JSON.stringify(globalThis.__portalRouteState.offerOutcomes).includes(validToken));
});

test("a measurement outage does not turn a published offer into a failed owner action", async () => {
  resetState();
  globalThis.__portalRouteState.metricFailure = true;
  const created = await request("post", "/portal/:token/offers", {
    body: { title: "Lunch", description: "Offer", startDate: "2099-01-01", endDate: "2099-01-31" },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(globalThis.__portalRouteState.offers.length, 1);
  assert.deepEqual(globalThis.__portalRouteState.offerOutcomes, []);
});

test("verified owner creates an event for the token-linked restaurant", async () => {
  resetState();
  const rejectedIdentity = await request("post", "/portal/:token/events", {
    body: {
      restaurantId: "someone-elses-place",
      title: "Jazz night",
      description: "Live jazz in the dining room.",
      date: "2099-04-10",
      time: "19:30",
      price: "£15.00",
    },
  });
  assert.equal(rejectedIdentity.statusCode, 400);

  const created = await request("post", "/portal/:token/events", {
    body: {
      title: "Jazz night",
      description: "Live jazz in the dining room.",
      date: "2099-04-10",
      time: "19:30",
      price: "£15.00",
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(globalThis.__portalRouteState.events[0].restaurantId, "place-1");
  assert.equal(globalThis.__portalRouteState.events[0].eventDate, "2099-04-10");
});

test("event validation rejects past dates, invalid times, prices, and oversized text", async () => {
  resetState();
  const valid = {
    title: "Jazz night",
    description: "Live jazz in the dining room.",
    date: "2099-04-10",
    time: "19:30",
    price: "£15.00",
  };
  for (const body of [
    { ...valid, date: "2020-01-01" },
    { ...valid, time: "25:00" },
    { ...valid, price: "fifteen-ish" },
    { ...valid, description: "x".repeat(1_001) },
  ]) {
    const result = await request("post", "/portal/:token/events", { body });
    assert.equal(result.statusCode, 400);
  }
  assert.equal(globalThis.__portalRouteState.events.length, 0);
});

test("event updates and deletes are scoped to the token-linked restaurant", async () => {
  resetState();
  globalThis.__portalRouteState.events.push({
    id: 9,
    restaurantId: "other-place",
    title: "Private event",
    description: "Owned by another listing.",
    eventDate: "2099-04-10",
    eventTime: "19:30",
    price: "Free",
  });
  const body = {
    title: "Changed",
    description: "Should not change.",
    date: "2099-04-11",
    time: "20:00",
    price: "£20.00",
  };
  const update = await request("patch", "/portal/:token/events/:eventId", {
    eventId: 9,
    body,
  });
  assert.equal(update.statusCode, 404);
  const deletion = await request("delete", "/portal/:token/events/:eventId", {
    eventId: 9,
  });
  assert.equal(deletion.statusCode, 404);
  assert.equal(globalThis.__portalRouteState.events[0].title, "Private event");
});

const validChef = {
  name: "Chef Ada",
  bio: "Leads the seasonal kitchen.",
  philosophy: "Respect the ingredient.",
  awards: ["Regional Chef of the Year"],
  awardEvidenceUrls: ["https://example.test/award"],
  signatureDishes: ["Charred leek"],
  dishEvidenceUrls: ["https://example.test/dish"],
};

test("chef owner routes reject invalid or unverified portal links", async () => {
  resetState(null);
  const denied = await request("put", "/portal/:token/chef", { body: validChef });
  assert.equal(denied.statusCode, 404);
  assert.equal(globalThis.__portalRouteState.chef.length, 0);

  resetState();
  const invalid = await request("put", "/portal/:token/chef", {
    token: "x".repeat(43),
    body: validChef,
  });
  assert.equal(invalid.statusCode, 404);
  assert.equal(globalThis.__portalRouteState.chef.length, 0);
});

test("chef owner submission enforces strict limits and is pending and token-scoped", async () => {
  resetState();
  for (const body of [
    { ...validChef, bio: "x".repeat(2_001) },
    { ...validChef, awards: Array.from({ length: 9 }, () => "Award") },
    { ...validChef, unexpected: "spoofed" },
    { ...validChef, restaurantId: "other-place" },
  ]) {
    const rejected = await request("put", "/portal/:token/chef", { body });
    assert.equal(rejected.statusCode, 400);
    assert.equal(globalThis.__portalRouteState.chef.length, 0);
  }

  const saved = await request("put", "/portal/:token/chef", { body: validChef });
  assert.equal(saved.statusCode, 200);
  assert.equal(globalThis.__portalRouteState.chef[0].restaurantId, "place-1");
  assert.equal(globalThis.__portalRouteState.chef[0].moderationStatus, "pending");
  assert.equal(globalThis.__portalRouteState.chef[0].name, "Chef Ada");
});

test("verified owner can delete the token-scoped chef profile", async () => {
  resetState();
  const created = await request("put", "/portal/:token/chef", { body: validChef });
  assert.equal(created.statusCode, 200);
  const deleted = await request("delete", "/portal/:token/chef");
  assert.equal(deleted.statusCode, 200);
  assert.equal(globalThis.__portalRouteState.chef.length, 0);
});

test("owner can explicitly remove the current chef photo", async () => {
  resetState();
  globalThis.__portalRouteState.chef.push({
    restaurantId: "place-1",
    ...validChef,
    photoObjectPath: "/objects/chef/00000000-0000-0000-0000-000000000000",
    photoMimeType: "image/jpeg",
    photoSizeBytes: 128,
    moderationStatus: "approved",
  });
  const result = await request("put", "/portal/:token/chef", {
    body: { ...validChef, removePhoto: true },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(globalThis.__portalRouteState.chef[0].photoObjectPath, null);
  assert.equal(globalThis.__portalRouteState.chef[0].photoMimeType, null);
});

test("chef photo finalize rejects intents owned by another restaurant", async () => {
  resetState();
  globalThis.__portalRouteState.intents.push({
    objectPath: "/objects/chef/11111111-1111-1111-1111-111111111111",
    restaurantId: "other-place",
    contentType: "image/jpeg",
    sizeBytes: 128,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  const result = await post("/portal/:token/chef/photo/finalize", {
    body: {
      objectPath: "/objects/chef/11111111-1111-1111-1111-111111111111",
      contentType: "image/jpeg",
      sizeBytes: 128,
    },
  });
  assert.equal(result.statusCode, 400);
  assert.equal(globalThis.__portalRouteState.intents[0].consumedAt, null);
});

test("chef photo finalize rejects unknown and replayed intents", async () => {
  resetState();
  const body = {
    objectPath: "/objects/chef/22222222-2222-2222-2222-222222222222",
    contentType: "image/png",
    sizeBytes: 256,
  };
  const unknown = await post("/portal/:token/chef/photo/finalize", { body });
  assert.equal(unknown.statusCode, 400);

  globalThis.__portalRouteState.intents.push({
    ...body,
    restaurantId: "place-1",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: new Date(),
  });
  const replay = await post("/portal/:token/chef/photo/finalize", { body });
  assert.equal(replay.statusCode, 400);
});

test("chef upload intent returns the signed PUT contract", async () => {
  resetState();
  const result = await post("/portal/:token/chef/photo/upload-intent", {
    body: { contentType: "image/jpeg", sizeBytes: 1024 },
  });
  assert.equal(result.statusCode, 201);
  assert.equal(result.payload.uploadUrl, "https://upload.test");
  assert.equal(result.payload.uploadMethod, "PUT");
  assert.deepEqual(result.payload.uploadHeaders, { "Content-Type": "image/jpeg" });
  assert.equal(globalThis.__portalRouteState.intentInsertCount, 1);
});

test("signing failure does not create or consume an upload intent", async () => {
  resetState();
  globalThis.__portalRouteState.signingFailure = true;
  const result = await post("/portal/:token/chef/photo/upload-intent", {
    body: { contentType: "image/png", sizeBytes: 2048 },
  });
  assert.equal(result.statusCode, 503);
  assert.equal(globalThis.__portalRouteState.intentInsertCount, 0);
});

test("owner private chef photo access is scoped to the token restaurant", async () => {
  resetState();
  globalThis.__portalRouteState.chef.push({
    restaurantId: "other-place",
    photoObjectPath: "/objects/chef/33333333-3333-3333-3333-333333333333",
  });
  const denied = await request("get", "/portal/:token/chef/photo");
  assert.equal(denied.statusCode, 404);
});

test("unverified listings cannot manage offers", async () => {
  resetState(null);
  const result = await request("post", "/portal/:token/offers", {
    body: {
      title: "Blocked",
      description: "Not verified.",
      startDate: "2099-01-01",
      endDate: "2099-01-31",
    },
  });
  assert.equal(result.statusCode, 404);
  assert.equal(globalThis.__portalRouteState.offers.length, 0);
});

test("unverified listings cannot manage events", async () => {
  resetState(null);
  const result = await request("post", "/portal/:token/events", {
    body: {
      title: "Blocked",
      description: "Not verified.",
      date: "2099-04-10",
      time: "19:30",
      price: "Free",
    },
  });
  assert.equal(result.statusCode, 404);
  assert.equal(globalThis.__portalRouteState.events.length, 0);
});

test("verified owner booking updates are token-scoped, validated, and removable", async () => {
  resetState();
  const spoofed = await request("put", "/portal/:token/booking", {
    body: { url: "https://bookings.example.com/table", restaurantId: "other-place" },
  });
  assert.equal(spoofed.statusCode, 400);

  const invalid = await request("put", "/portal/:token/booking", {
    body: { url: "not-a-url" },
  });
  assert.equal(invalid.statusCode, 400);

  for (const url of ["https://private.example/table", "https://redirect-abuse.example/table"]) {
    const rejected = await request("put", "/portal/:token/booking", { body: { url } });
    assert.equal(rejected.statusCode, 400);
  }

  const saved = await request("put", "/portal/:token/booking", {
    body: { url: "https://bookings.example.com/table", provider: "ExampleBook" },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(globalThis.__portalRouteState.restaurant.bookingUrl, "https://bookings.example.com/table");
  assert.equal(globalThis.__portalRouteState.restaurant.bookingStatus, "approved");

  const removed = await request("delete", "/portal/:token/booking");
  assert.equal(removed.statusCode, 200);
  assert.equal(globalThis.__portalRouteState.restaurant.bookingUrl, null);
});

test("unverified and invalid-token owners cannot change booking links", async () => {
  resetState(null);
  const unverified = await request("put", "/portal/:token/booking", {
    body: { url: "https://bookings.example.com/table" },
  });
  assert.equal(unverified.statusCode, 404);

  resetState();
  const invalid = await request("put", "/portal/:token/booking", {
    token: "x".repeat(43),
    body: { url: "https://bookings.example.com/table" },
  });
  assert.equal(invalid.statusCode, 404);
  assert.equal(globalThis.__portalRouteState.restaurant.bookingUrl, null);
});

test.after(async () => {
  await bundled.cleanup();
});