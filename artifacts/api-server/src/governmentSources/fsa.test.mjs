import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchFsaBatch } from "./fsa.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("fetchFsaBatch bounds the request, validates records, and paginates", async () => {
  let requestedUrl;
  let requestedOptions;
  globalThis.fetch = async (url, options) => {
    requestedUrl = new URL(url);
    requestedOptions = options;
    return Response.json({
      meta: {
        dataSource: "ElasticSearch",
        extractDate: "2026-09-26T09:49:49.4036703+01:00",
        itemCount: 3,
        returncode: "OK",
        totalCount: 141024,
        totalPages: 47008,
        pageSize: 3,
        pageNumber: 1,
      },
      establishments: [
        {
          FHRSID: 12345,
          BusinessName: "The Example Cafe",
          BusinessType: "Restaurant/Cafe/Canteen",
          AddressLine1: "1 High Street",
          AddressLine4: "Sampletown",
          PostCode: "AB1 2CD",
          LocalAuthorityName: "Example Borough",
          geocode: { latitude: "51.5", longitude: "-0.1" },
        },
        {
          FHRSID: 12346,
          BusinessName: "Missing address",
          AddressLine1: " ",
          LocalAuthorityName: "Sample Borough",
        },
        {
          FHRSID: 12347,
          BusinessName: "School Canteen",
          AddressLine1: "School Road",
          AddressLine4: "Sampletown",
        },
      ],
    });
  };

  const result = await fetchFsaBatch(null, 1_000);

  assert.equal(requestedUrl.origin, "https://api.ratings.food.gov.uk");
  assert.equal(requestedUrl.pathname, "/Establishments");
  assert.equal(requestedUrl.searchParams.get("businessTypeId"), "1");
  assert.equal(requestedUrl.searchParams.get("pageNumber"), "1");
  assert.equal(requestedUrl.searchParams.get("pageSize"), "100");
  assert.equal(requestedOptions.headers["x-api-version"], "2");
  assert.equal(result.scanned, 3);
  assert.equal(result.nextCursor, "2");
  assert.equal(result.listings.length, 1);
  assert.deepEqual(result.listings[0], {
    source: "FSA_UK",
    sourceId: "12345",
    name: "The Example Cafe",
    address: "1 High Street, Sampletown, AB1 2CD",
    city: "Sampletown",
    region: "Example Borough",
    country: "United Kingdom",
    currency: "GBP",
    latitude: 51.5,
    longitude: -0.1,
    attribution:
      "Contains public sector information licensed under the Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).",
    sourceUrl: "https://api.ratings.food.gov.uk/Establishments",
  });
});

test("fetchFsaBatch clamps page size and accepts a numeric page cursor", async () => {
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = new URL(url);
    return Response.json({
      meta: { pageNumber: 2, totalPages: 2 },
      establishments: [],
    });
  };

  const result = await fetchFsaBatch("2", 250);

  assert.equal(requestedUrl.searchParams.get("pageNumber"), "2");
  assert.equal(requestedUrl.searchParams.get("pageSize"), "100");
  assert.equal(result.nextCursor, null);
});

test("fetchFsaBatch rejects invalid cursors and oversized responses", async () => {
  await assert.rejects(fetchFsaBatch("0", 10), /positive page number/);

  globalThis.fetch = async () =>
    new Response("{}", {
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    });

  await assert.rejects(fetchFsaBatch(null, 10), /exceeds the 2 MB limit/);
});