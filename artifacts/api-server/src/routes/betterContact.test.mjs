import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { build } from "esbuild";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = await mkdtemp(path.join(tmpdir(), "better-contact-routes-"));
const outfile = path.join(directory, "routes.mjs");
await build({
  entryPoints: [path.join(import.meta.dirname, "betterContact.ts")],
  outfile, bundle: true, platform: "node", format: "esm",
  plugins: [{
    name: "private-contact-service-fixture",
    setup(builder) {
      for (const packageName of ["express", "zod"]) {
        builder.onResolve({ filter: new RegExp(`^${packageName}$`) }, () => ({
          path: fileURLToPath(import.meta.resolve(packageName)), external: true,
        }));
      }
      builder.onResolve({ filter: /services\/enrichment\/betterContact$/ }, () => ({
        path: "service", namespace: "fixture",
      }));
      builder.onLoad({ filter: /^service$/, namespace: "fixture" }, () => ({
        contents: `
          const state = () => globalThis.__contactRouteState;
          export async function getBetterContactBudgetForReview() {
            state().calls.push("budget");
            return { enabled: true, configuredCap: 1, effectiveCap: 1,
              availableCredits: 1, reservedCredits: 0, consumedCredits: 0 };
          }
          export async function listBetterContactJobsForReview() {
            state().calls.push("list");
            return [{ id: state().id, status: "polling" }];
          }
          export async function getBetterContactJobForReview(id) {
            state().calls.push("review");
            return id === state().id ? { job: { id, status: "completed" },
              privateReviewContact: { email: "private@example.test",
                providerEmailStatus: "deliverable", reviewOnly: true,
                outreachEligible: false } } : null;
          }
          export async function reserveBetterContactJob(input) {
            state().calls.push("reserve");
            state().reservation = input;
            return { created: true, job: { id: state().id, status: "reserved" } };
          }
          export async function reconcileBetterContactJob() {
            state().calls.push("reconcile");
            return { id: state().id, status: "polling" };
          }
          export async function correctBetterContactRequestId(input) {
            state().calls.push("correct");
            state().correction = input;
            return { id: state().id, status: "polling", providerRequestId: input.newProviderRequestId };
          }
        `,
      }));
    },
  }],
});

const router = (await import(pathToFileURL(outfile).href)).default;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.session = req.headers["x-test-admin"] === "yes" ? { admin: true } : {};
  req.log = { warn() {} };
  next();
});
app.use("/api", router);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
const id = "00000000-0000-4000-8000-000000000001";
const body = {
  firstName: "Jane", lastName: "Owner", company: "Example Bistro",
  companyDomain: "example.test", personSource: "Reviewed public business filing",
  optIn: true, maxCredits: 1,
};
const admin = { "x-test-admin": "yes" };
const post = (headers = {}) => ({
  method: "POST", headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

beforeEach(() => {
  globalThis.__contactRouteState = { calls: [], id, reservation: null };
});
after(async () => {
  delete globalThis.__contactRouteState;
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});
async function request(route, options) {
  const response = await fetch(base + route, options);
  return { status: response.status, cache: response.headers.get("cache-control"),
    body: await response.json() };
}

test("all private read and paid-write routes deny anonymous requests before service work", async () => {
  for (const [route, options] of [
    ["/private-contact-enrichments/budget"],
    ["/private-contact-enrichments"],
    [`/private-contact-enrichments/${id}`],
    ["/restaurants/place-1/private-contact-enrichments", post()],
    [`/private-contact-enrichments/${id}/reconcile`, post()],
    [`/private-contact-enrichments/${id}/correct-request-id`, post()],
  ]) {
    const result = await request(route, options);
    assert.equal(result.status, 401, route);
    assert.equal(result.body.success, false, route);
    assert.equal(result.cache, "no-store", route);
  }
  assert.deepEqual(globalThis.__contactRouteState.calls, []);
});

test("admin can read the budget, recent jobs, and private review, and reserve exactly one credit", async () => {
  const options = { headers: admin };
  const budget = await request("/private-contact-enrichments/budget", options);
  assert.equal(budget.status, 200);
  assert.equal(budget.body.data.effectiveCap, 1);
  assert.equal(budget.body.data.availableCredits, 1);
  const jobs = await request("/private-contact-enrichments", options);
  assert.deepEqual(jobs.body.data, [{ id, status: "polling" }]);
  const detail = await request(`/private-contact-enrichments/${id}`, options);
  assert.equal(detail.body.data.privateReviewContact.reviewOnly, true);
  assert.equal(detail.body.data.privateReviewContact.outreachEligible, false);
  const reservation = await request("/restaurants/place-1/private-contact-enrichments", post(admin));
  assert.equal(reservation.status, 202);
  assert.deepEqual(reservation.body.data, { id, status: "reserved", created: true });
  assert.deepEqual(globalThis.__contactRouteState.reservation, {
    placeId: "place-1", firstName: "Jane", lastName: "Owner",
    company: "Example Bistro", companyDomain: "example.test",
    personSource: "Reviewed public business filing", maxCredits: 1,
  });
});

test("admin cannot reserve without explicit one-credit opt-in and provenance", async () => {
  for (const invalid of [
    { ...body, maxCredits: 2 }, { ...body, optIn: false },
    { ...body, personSource: "" },
  ]) {
    const result = await request("/restaurants/place-1/private-contact-enrichments", {
      method: "POST", headers: { ...admin, "content-type": "application/json" },
      body: JSON.stringify(invalid),
    });
    assert.equal(result.status, 400);
  }
  assert.deepEqual(globalThis.__contactRouteState.calls, []);
});

test("correction requires admin and explicit evidence fields", async () => {
  const route = `/private-contact-enrichments/${id}/correct-request-id`;
  const correction = {
    oldProviderRequestId: "old-1", newProviderRequestId: "new-2",
    evidenceNote: "Checked both terminated provider records.", confirmedCorrection: true,
  };
  for (const invalid of [
    { ...correction, confirmedCorrection: false },
    { ...correction, evidenceNote: "brief" },
    { ...correction, newProviderRequestId: "bad/id" },
  ]) {
    const result = await request(route, {
      method: "POST", headers: { ...admin, "content-type": "application/json" },
      body: JSON.stringify(invalid),
    });
    assert.equal(result.status, 400);
  }
  assert.deepEqual(globalThis.__contactRouteState.calls, []);
  const result = await request(route, {
    method: "POST", headers: { ...admin, "content-type": "application/json" },
    body: JSON.stringify(correction),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.providerRequestId, "new-2");
  assert.deepEqual(globalThis.__contactRouteState.correction, { jobId: id, ...correction });
});