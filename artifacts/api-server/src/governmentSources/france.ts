import type { GovernmentListing, GovernmentPage } from "./types";

const API_ORIGIN = "https://dgal.opendatasoft.com";
const API_PATH = "/api/explore/v2.1/catalog/datasets/export_alimconfiance/records";
const DATASET_PAGE =
  "https://www.data.gouv.fr/datasets/resultats-des-controles-officiels-sanitaires-dispositif-dinformation-alimconfiance/";
const MAX_LIMIT = 100;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const ATTRIBUTION =
  "Données : ministère de l’Agriculture — Alim’confiance. Licence Ouverte / Open Licence (Etalab).";

interface AlimConfianceRecord {
  code_ua?: unknown;
  siret?: unknown;
  app_libelle_etablissement?: unknown;
  libelle_etablissement?: unknown;
  enseigne?: unknown;
  raison_sociale?: unknown;
  adresse_activite?: unknown;
  adresse_1_ua?: unknown;
  adresse_2_ua?: unknown;
  adresse_3_ua?: unknown;
  com_name?: unknown;
  libelle_commune?: unknown;
  localite?: unknown;
  reg_name?: unknown;
  geores?: unknown;
}

interface AlimConfianceResponse {
  results?: unknown;
}

function cleanText(value: unknown, maxLength = 300): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length > 0 && cleaned.length <= maxLength ? cleaned : null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function coordinate(value: unknown, min: number, max: number): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function toListing(record: AlimConfianceRecord): GovernmentListing | null {
  const sourceId =
    firstText(record.code_ua, record.siret) ??
    null;
  const name = firstText(
    record.app_libelle_etablissement,
    record.libelle_etablissement,
    record.enseigne,
    record.raison_sociale,
  );
  const address =
    firstText(record.adresse_activite) ??
    [record.adresse_1_ua, record.adresse_2_ua, record.adresse_3_ua]
      .map((value) => cleanText(value))
      .filter((value): value is string => value !== null)
      .join(", ");
  const city = firstText(record.com_name, record.libelle_commune, record.localite);

  if (!sourceId || !name || !address || !city) return null;

  const geo =
    record.geores && typeof record.geores === "object"
      ? (record.geores as { lat?: unknown; lon?: unknown })
      : null;

  return {
    source: "ALIM_FR",
    sourceId,
    name,
    address,
    city,
    region: firstText(record.reg_name),
    country: "France",
    currency: "EUR",
    latitude: coordinate(geo?.lat, -90, 90),
    longitude: coordinate(geo?.lon, -180, 180),
    attribution: ATTRIBUTION,
    sourceUrl: DATASET_PAGE,
  };
}

async function readJsonWithinLimit(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("Alim’confiance response exceeded the 2 MB limit.");
  }

  if (!response.body) {
    throw new Error("Alim’confiance returned an empty response body.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Alim’confiance response exceeded the 2 MB limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

/**
 * Read one bounded page of active French restaurant listings from the official
 * Alim’confiance open-data feed. This adapter is read-only.
 */
export async function fetchFranceBatch(
  cursor: string | null,
  limit: number,
): Promise<GovernmentPage> {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new RangeError("Alim’confiance batch limit must be a positive number.");
  }

  const safeLimit = Math.min(MAX_LIMIT, Math.trunc(limit));
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) {
    throw new TypeError("Alim’confiance cursor is not a valid code_ua.");
  }

  const conditions = [
    "filtre = 'Restaurants'",
    "date_de_cessation_bdnu IS NULL",
    "code_ua IS NOT NULL",
  ];
  if (cursor !== null) conditions.push(`code_ua > '${cursor}'`);

  const url = new URL(API_PATH, API_ORIGIN);
  url.searchParams.set("limit", String(safeLimit));
  url.searchParams.set("select", [
    "code_ua",
    "siret",
    "app_libelle_etablissement",
    "libelle_etablissement",
    "enseigne",
    "raison_sociale",
    "adresse_activite",
    "adresse_1_ua",
    "adresse_2_ua",
    "adresse_3_ua",
    "com_name",
    "libelle_commune",
    "localite",
    "reg_name",
    "geores",
  ].join(","));
  url.searchParams.set("where", conditions.join(" AND "));
  url.searchParams.set("order_by", "code_ua asc");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Alim’confiance request failed with HTTP ${response.status}.`);
  }

  const payload = (await readJsonWithinLimit(response)) as AlimConfianceResponse;
  if (!Array.isArray(payload.results)) {
    throw new Error("Alim’confiance returned an invalid records response.");
  }

  const records = payload.results as AlimConfianceRecord[];
  const listings = records
    .map(toListing)
    .filter((listing): listing is GovernmentListing => listing !== null);
  const lastRecord = records.at(-1);
  const lastCursor = lastRecord ? firstText(lastRecord.code_ua) : null;

  return {
    listings,
    scanned: records.length,
    nextCursor: records.length === safeLimit ? lastCursor : null,
  };
}