import assert from "node:assert/strict";
import test from "node:test";
import { fetchNycBatch } from "./nyc.ts";

const validRow = (camis, values = {}) => ({
  camis,
  dba: "Example Restaurant",
  building: "10",
  street: "BROADWAY",
  boro: "MANHATTAN",
  latitude: "40.7128",
  longitude: "-74.0060",
  ...values,
});

test("fetches a bounded unique-CAMIS page from the fixed NYC Open Data origin", async (t) => {
  const rows = [validRow("10000001"), validRow("10000002")];
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } }),
  );

  const page = await fetchNycBatch(null, 2);
  const requestedUrl = new URL(fetchMock.mock.calls[0].arguments[0]);

  assert.equal(requestedUrl.origin, "https://data.cityofnewyork.us");
  assert.equal(requestedUrl.pathname, "/resource/43nn-pn8j.json");
  assert.equal(requestedUrl.searchParams.get("$limit"), "2");
  assert.equal(requestedUrl.searchParams.get("$group"), "camis");
  assert.equal(requestedUrl.searchParams.get("$order"), "camis");
  assert.equal(requestedUrl.searchParams.get("$where"), null);
  assert.equal(page.scanned, 2);
  assert.equal(page.nextCursor, "10000002");
  assert.deepEqual(page.listings[0], {
    source: "NYC_DOHMH",
    sourceId: "10000001",
    name: "Example Restaurant",
    address: "10 BROADWAY",
    city: "New York",
    region: "MANHATTAN",
    country: "United States",
    currency: "USD",
    latitude: 40.7128,
    longitude: -74.006,
    attribution: "NYC Department of Health and Mental Hygiene via NYC Open Data",
    sourceUrl: "https://data.cityofnewyork.us/resource/43nn-pn8j.json",
  });
  assert.equal("grade" in page.listings[0], false);
});

test("uses the CAMIS cursor and omits invalid source records", async (t) => {
  const rows = [
    validRow("10000004"),
    validRow("invalid-id"),
    validRow("10000006", { street: "" }),
  ];
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify(rows)),
  );

  const page = await fetchNycBatch("10000003", 3);
  const requestedUrl = new URL(fetchMock.mock.calls[0].arguments[0]);

  assert.equal(requestedUrl.searchParams.get("$where"), "camis > 10000003");
  assert.equal(page.scanned, 3);
  assert.equal(page.listings.length, 1);
  assert.equal(page.listings[0].sourceId, "10000004");
  assert.equal(page.nextCursor, "10000006");
});

test("rejects invalid cursors and limits without making a request", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should not be called");
  });

  await assert.rejects(fetchNycBatch("1 OR 1=1", 10), /cursor/);
  await assert.rejects(fetchNycBatch(null, 0), /limit/);
  await assert.rejects(fetchNycBatch(null, 101), /limit/);
  assert.equal(fetchMock.mock.calls.length, 0);
});

test("rejects response bodies larger than 2 MB", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response("[]", { headers: { "content-length": String(2 * 1024 * 1024 + 1) } }),
  );
  await assert.rejects(fetchNycBatch(null, 10), /2 MB limit/);
});

test("reports upstream errors and fails closed on malformed JSON", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("nope"));
  await assert.rejects(fetchNycBatch(null, 10), /invalid JSON/);

  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(fetchNycBatch(null, 10), /HTTP 503/);
});