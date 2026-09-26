import type { GovernmentListing, GovernmentPage } from "./types";

const NYC_OPEN_DATA_ORIGIN = "https://data.cityofnewyork.us";
const NYC_RESTAURANT_INSPECTIONS_PATH = "/resource/43nn-pn8j.json";
const NYC_RESTAURANT_INSPECTIONS_URL = `${NYC_OPEN_DATA_ORIGIN}${NYC_RESTAURANT_INSPECTIONS_PATH}`;
const MAX_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const BOROUGHS = new Set(["BRONX", "BROOKLYN", "MANHATTAN", "QUEENS", "STATEN ISLAND"]);

interface SocrataRestaurantRow {
  camis?: unknown;
  dba?: unknown;
  building?: unknown;
  street?: unknown;
  boro?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 0 ? text.slice(0, 200) : null;
}

function normalizeCoordinate(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (String(value).trim() === "") return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum
    ? coordinate
    : null;
}

function normalizeListing(row: SocrataRestaurantRow): GovernmentListing | null {
  const sourceId = normalizeText(row.camis);
  const name = normalizeText(row.dba);
  const building = normalizeText(row.building);
  const street = normalizeText(row.street);
  const borough = normalizeText(row.boro)?.toUpperCase() ?? null;
  if (
    !sourceId ||
    !/^\d{1,12}$/.test(sourceId) ||
    !name ||
    !building ||
    !street ||
    !borough ||
    !BOROUGHS.has(borough)
  ) {
    return null;
  }

  const latitude = normalizeCoordinate(row.latitude, -90, 90);
  const longitude = normalizeCoordinate(row.longitude, -180, 180);

  return {
    source: "NYC_DOHMH",
    sourceId,
    name,
    address: `${building} ${street}`,
    city: "New York",
    region: borough,
    country: "United States",
    currency: "USD",
    latitude,
    longitude,
    attribution: "NYC Department of Health and Mental Hygiene via NYC Open Data",
    sourceUrl: NYC_RESTAURANT_INSPECTIONS_URL,
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("NYC Open Data response exceeds the 2 MB limit");
  }
  if (!response.body) {
    throw new Error("NYC Open Data returned an empty response body");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("NYC Open Data response exceeds the 2 MB limit");
    }
    chunks.push(value);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("NYC Open Data returned invalid JSON");
  }
}

/**
 * Fetch one bounded, read-only page of NYC DOHMH restaurant inspection records.
 * The source contains inspection history and does not establish that a business
 * is currently open; callers must not treat these records as verified active
 * businesses without an independent status check.
 */
export async function fetchNycBatch(
  cursor: string | null,
  limit: number,
): Promise<GovernmentPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`NYC batch limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  if (cursor !== null && !/^\d{1,12}$/.test(cursor)) {
    throw new Error("NYC cursor must contain only CAMIS digits");
  }

  const url = new URL(NYC_RESTAURANT_INSPECTIONS_PATH, NYC_OPEN_DATA_ORIGIN);
  url.searchParams.set(
    "$select",
    "camis,max(dba) as dba,max(building) as building,max(street) as street,max(boro) as boro,max(latitude) as latitude,max(longitude) as longitude",
  );
  url.searchParams.set("$group", "camis");
  url.searchParams.set("$order", "camis");
  url.searchParams.set("$limit", String(limit));
  if (cursor !== null) {
    url.searchParams.set("$where", `camis > ${cursor}`);
  }

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`NYC Open Data request failed with HTTP ${response.status}`);
  }

  const payload = await readBoundedJson(response);
  if (!Array.isArray(payload)) {
    throw new Error("NYC Open Data returned an unexpected response shape");
  }

  const rows = payload as SocrataRestaurantRow[];
  const listings = rows.flatMap((row) => {
    const listing = normalizeListing(row);
    return listing ? [listing] : [];
  });
  const lastSourceId = normalizeText(rows.at(-1)?.camis);

  return {
    listings,
    scanned: rows.length,
    nextCursor: rows.length === limit && lastSourceId && /^\d{1,12}$/.test(lastSourceId)
      ? lastSourceId
      : null,
  };
}