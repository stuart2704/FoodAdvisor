import type { GovernmentListing, GovernmentPage } from "./types";

const FSA_ESTABLISHMENTS_URL = "https://api.ratings.food.gov.uk/Establishments";
const FSA_OPEN_GOVERNMENT_LICENCE =
  "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
const MAX_PAGE_SIZE = 100;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;

type FsaEstablishment = Record<string, unknown>;

interface FsaResponse {
  establishments?: unknown;
  meta?: Record<string, unknown>;
  pageNumber?: unknown;
  totalPages?: unknown;
}

function boundedPageSize(limit: number): number {
  if (!Number.isFinite(limit)) return 1;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit)));
}

function pageFromCursor(cursor: string | null): number {
  if (cursor === null) return 1;
  if (!/^[1-9]\d*$/.test(cursor)) {
    throw new RangeError("FSA cursor must be a positive page number.");
  }

  const page = Number(cursor);
  if (!Number.isSafeInteger(page)) {
    throw new RangeError("FSA cursor is outside the supported page range.");
  }
  return page;
}

function textField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const valueTrimmed = value.trim();
  return valueTrimmed.length > 0 ? valueTrimmed : null;
}

function sourceId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function coordinate(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function isInstitutionalOutlet(
  name: string,
  businessType: string | null,
): boolean {
  if (
    businessType &&
    /\b(?:school|university|college|hospital|prison|care home|nursing home)\b/i.test(
      businessType,
    )
  ) {
    return true;
  }

  return /\b(?:school|university|college|hospital|prison|care home|nursing home)\s+(?:canteen|cafeteria|café|cafe|kitchen|dining(?:\s+hall)?|restaurant|food\s+services?)\b/i.test(
    name,
  );
}

function toGovernmentListing(
  establishment: FsaEstablishment,
): GovernmentListing | null {
  const id = sourceId(establishment.FHRSID);
  const name = textField(establishment.BusinessName);
  const addressLines = [
    establishment.AddressLine1,
    establishment.AddressLine2,
    establishment.AddressLine3,
    establishment.AddressLine4,
  ]
    .map(textField)
    .filter((value): value is string => value !== null);
  const postcode = textField(establishment.PostCode);
  const localAuthority = textField(establishment.LocalAuthorityName);
  const city =
    textField(establishment.AddressLine4) ??
    textField(establishment.AddressLine3) ??
    localAuthority;
  const businessType = textField(establishment.BusinessType);

  if (
    !id ||
    !name ||
    !city ||
    addressLines.length === 0 ||
    isInstitutionalOutlet(name, businessType)
  ) {
    return null;
  }

  const geocodeValue = establishment.geocode ?? establishment.Geocode;
  const geocode =
    typeof geocodeValue === "object" && geocodeValue !== null
      ? (geocodeValue as Record<string, unknown>)
      : {};
  const address = [...addressLines, postcode].filter(Boolean).join(", ");

  return {
    source: "FSA_UK",
    sourceId: id,
    name,
    address,
    city,
    region: localAuthority,
    country: "United Kingdom",
    currency: "GBP",
    latitude: coordinate(geocode.latitude ?? geocode.Latitude, -90, 90),
    longitude: coordinate(geocode.longitude ?? geocode.Longitude, -180, 180),
    attribution: `Contains public sector information licensed under the Open Government Licence v3.0 (${FSA_OPEN_GOVERNMENT_LICENCE}).`,
    sourceUrl: FSA_ESTABLISHMENTS_URL,
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("FSA response exceeds the 2 MB limit.");
  }

  if (!response.body) {
    throw new Error("FSA response did not include a readable body.");
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
        throw new Error("FSA response exceeds the 2 MB limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch (error) {
    throw new Error("FSA returned invalid JSON.", { cause: error });
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Fetches one bounded page of official UK Food Standards Agency
 * restaurant/cafe/canteen inspection records. This function is read-only.
 */
export async function fetchFsaBatch(
  cursor: string | null,
  limit: number,
): Promise<GovernmentPage> {
  const pageNumber = pageFromCursor(cursor);
  const pageSize = boundedPageSize(limit);
  const url = new URL(FSA_ESTABLISHMENTS_URL);
  url.searchParams.set("businessTypeId", "1");
  url.searchParams.set("pageNumber", String(pageNumber));
  url.searchParams.set("pageSize", String(pageSize));

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-api-version": "2",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const errorName = (error as { name?: unknown } | null)?.name;
    if (errorName === "TimeoutError" || errorName === "AbortError") {
      throw new Error("FSA request timed out after 12 seconds.", {
        cause: error,
      });
    }
    throw new Error("FSA request failed.", { cause: error });
  }

  if (!response.ok) {
    throw new Error(`FSA request failed with HTTP ${response.status}.`);
  }

  const payload = asObject(await readBoundedJson(response)) as
    | FsaResponse
    | null;
  if (!payload || !Array.isArray(payload.establishments)) {
    throw new Error("FSA response is missing its establishments list.");
  }

  const rawEstablishments = payload.establishments;
  const listings = rawEstablishments
    .map(asObject)
    .filter((establishment): establishment is FsaEstablishment =>
      Boolean(establishment),
    )
    .map(toGovernmentListing)
    .filter((listing): listing is GovernmentListing => listing !== null);

  const metadata = asObject(payload.meta);
  const reportedPage =
    positiveInteger(metadata?.pageNumber) ??
    positiveInteger(payload.pageNumber) ??
    pageNumber;
  const totalPages =
    positiveInteger(metadata?.totalPages) ??
    positiveInteger(payload.totalPages);
  const hasMorePages =
    totalPages !== null
      ? reportedPage < totalPages
      : rawEstablishments.length >= pageSize;

  return {
    listings,
    scanned: rawEstablishments.length,
    nextCursor: hasMorePages ? String(reportedPage + 1) : null,
  };
}