import assert from "node:assert/strict";
import test from "node:test";
import { fetchFranceBatch } from "./france.ts";

const originalFetch = globalThis.fetch;

function makeRecord(overrides = {}) {
  return {
    code_ua: "02405858800021_00002",
    siret: "02405858800021",
    app_libelle_etablissement: "  Café   Exemple ",
    adresse_activite: "12 rue Exemple",
    com_name: "Paris",
    libelle_commune: "Paris",
    reg_name: "Île-de-France",
    geores: { lat: 48.8566, lon: 2.3522 },
    ...overrides,
  };
}

test("fetchFranceBatch uses the official feed, restaurant/active filters, and stable keyset pagination", async () => {
  let requestedUrl;
  globalThis.fetch = async (url, options) => {
    requestedUrl = new URL(url);
    assert.equal(options.headers.accept, "application/json");
    assert.ok(options.signal);
    return new Response(
      JSON.stringify({ results: [makeRecord()], total_count: 33069 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const page = await fetchFranceBatch("02405858800021_00001", 250);
    assert.equal(requestedUrl.origin, "https://dgal.opendatasoft.com");
    assert.equal(
      requestedUrl.pathname,
      "/api/explore/v2.1/catalog/datasets/export_alimconfiance/records",
    );
    assert.equal(requestedUrl.searchParams.get("limit"), "100");
    assert.equal(requestedUrl.searchParams.get("order_by"), "code_ua asc");
    assert.match(requestedUrl.searchParams.get("where"), /filtre = 'Restaurants'/);
    assert.match(
      requestedUrl.searchParams.get("where"),
      /date_de_cessation_bdnu IS NULL/,
    );
    assert.match(
      requestedUrl.searchParams.get("where"),
      /code_ua > '02405858800021_00001'/,
    );
    assert.equal(page.scanned, 1);
    assert.equal(page.nextCursor, null);
    assert.deepEqual(page.listings[0], {
      source: "ALIM_FR",
      sourceId: "02405858800021_00002",
      name: "Café Exemple",
      address: "12 rue Exemple",
      city: "Paris",
      region: "Île-de-France",
      country: "France",
      currency: "EUR",
      latitude: 48.8566,
      longitude: 2.3522,
      attribution:
        "Données : ministère de l’Agriculture — Alim’confiance. Licence Ouverte / Open Licence (Etalab).",
      sourceUrl:
        "https://www.data.gouv.fr/datasets/resultats-des-controles-officiels-sanitaires-dispositif-dinformation-alimconfiance/",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchFranceBatch omits incomplete listings while advancing past scanned records", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          makeRecord({ app_libelle_etablissement: null, libelle_etablissement: "" }),
          makeRecord({
            code_ua: "02405858800021_00003",
            app_libelle_etablissement: "Second Café",
            adresse_activite: null,
            adresse_2_ua: "2 rue Exemple",
            geores: { lat: 100, lon: "not-a-coordinate" },
          }),
        ],
      }),
      { status: 200 },
    );

  try {
    const page = await fetchFranceBatch(null, 2);
    assert.equal(page.scanned, 2);
    assert.equal(page.nextCursor, "02405858800021_00003");
    assert.equal(page.listings.length, 1);
    assert.equal(page.listings[0].name, "Second Café");
    assert.equal(page.listings[0].address, "2 rue Exemple");
    assert.equal(page.listings[0].latitude, null);
    assert.equal(page.listings[0].longitude, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchFranceBatch rejects malformed cursors and non-positive batch sizes", async () => {
  await assert.rejects(() => fetchFranceBatch("bad' OR 1=1", 10), TypeError);
  await assert.rejects(() => fetchFranceBatch(null, 0), RangeError);
});

test("fetchFranceBatch rejects an oversized response", async () => {
  globalThis.fetch = async () =>
    new Response(" ".repeat(2 * 1024 * 1024 + 1), {
      status: 200,
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
    });

  try {
    await assert.rejects(
      () => fetchFranceBatch(null, 1),
      /exceeded the 2 MB limit/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});