/**
 * One-off, offline catalogue recovery. Never calls the Places, enrichment, or
 * outreach pipelines. Run from the repository root:
 *   pnpm --filter api-server run catalogue:import
 *   pnpm --filter api-server run catalogue:import --apply
 *
 * The first command validates the entire export and previews the target DB.
 * --apply is explicit; rerunning it is safe after an interrupted batch.
 */
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { pool } from "@workspace/db";
import { restaurantSlug } from "../utils/slugify";

const HEADERS = [
  "google_place_id", "name", "address", "city", "rating",
  "website", "google_maps_url", "types", "imported_at",
];
const BATCH_SIZE = 100;
type RecordRow = {
  placeId: string;
  name: string;
  address: string;
  city: string;
  rating: number | null;
  website: string | null;
  googleMapsUrl: string;
  types: string[];
  importedAt: Date;
};

function fields(record: string): string[] {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  let endedQuote = false;
  for (let i = 0; i < record.length; i++) {
    const char = record[i];
    if (quoted) {
      if (char === '"' && record[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        endedQuote = true;
      } else {
        value += char;
      }
    } else if (char === ",") {
      result.push(value);
      value = "";
      endedQuote = false;
    } else if (char === '"' && !value && !endedQuote) {
      quoted = true;
    } else if (char === '"' || endedQuote) {
      throw new Error("Invalid CSV quoting");
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  result.push(value);
  return result;
}

function validUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function parseRow(values: string[]): RecordRow {
  if (values.length !== HEADERS.length) throw new Error("Wrong column count");
  const [placeId, name, address, city, ratingText, website, maps, types, dateText] =
    values.map((value) => value.trim());
  if (!placeId || placeId.length > 512 || !name || !address || !city || !maps) {
    throw new Error("Missing or oversized required field");
  }
  if (!validUrl(maps) || (website && !validUrl(website))) {
    throw new Error("Invalid URL");
  }
  const rating = ratingText ? Number(ratingText) : null;
  if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) {
    throw new Error("Invalid rating");
  }
  const importedAt = new Date(dateText);
  if (!dateText || !Number.isFinite(importedAt.getTime())) {
    throw new Error("Invalid import timestamp");
  }
  return {
    placeId, name, address, city, rating, website: website || null,
    googleMapsUrl: maps, types: types ? types.split("|").map((type) => type.trim()) : [],
    importedAt,
  };
}

async function profile(path: string) {
  const unique = new Map<string, RecordRow>();
  const rejected = new Map<string, number>();
  const examples: { line: number; reason: string }[] = [];
  let rows = 0;
  let duplicateRows = 0;
  let conflictingDuplicates = 0;
  let lineNumber = 0;
  let recordStart = 0;
  let record = "";
  let inQuotes = false;
  const input = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of input) {
    lineNumber++;
    if (!record) recordStart = lineNumber;
    else record += "\n";
    record += line;
    // An odd number of quotes means this logical CSV record continues on the
    // next physical line. Doubled quotes contribute an even number.
    for (const char of line) if (char === '"') inQuotes = !inQuotes;
    if (record.length > 1_000_000) throw new Error(`CSV record exceeds 1 MB at line ${recordStart}`);
    if (inQuotes) continue;
    let values: string[];
    try {
      values = fields(record);
    } catch (error) {
      throw new Error(`Malformed CSV at line ${recordStart}: ${String(error)}`);
    }
    record = "";
    if (recordStart === 1) {
      if (values[0]?.replace(/^\uFEFF/, "") !== HEADERS[0] ||
        values.slice(1).some((field, i) => field !== HEADERS[i + 1]) ||
        values.length !== HEADERS.length) {
        throw new Error("Unexpected CSV header; no records can be imported");
      }
      continue;
    }
    rows++;
    if (values.join(",") === HEADERS.join(",")) {
      rejected.set("Repeated CSV header", (rejected.get("Repeated CSV header") ?? 0) + 1);
      if (examples.length < 10) examples.push({ line: recordStart, reason: "Repeated CSV header" });
      continue;
    }
    try {
      const row = parseRow(values);
      const previous = unique.get(row.placeId);
      if (previous) {
        duplicateRows++;
        if (JSON.stringify(row) !== JSON.stringify(previous)) {
          conflictingDuplicates++;
          if (row.importedAt > previous.importedAt) unique.set(row.placeId, row);
        }
      } else {
        unique.set(row.placeId, row);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Invalid row";
      rejected.set(reason, (rejected.get(reason) ?? 0) + 1);
      if (examples.length < 10) examples.push({ line: recordStart, reason });
    }
  }
  if (inQuotes || record) throw new Error("Truncated CSV record at end of file");
  if (!rows || !unique.size) throw new Error("No valid restaurants in CSV");
  return { rows, unique, duplicateRows, conflictingDuplicates, rejected: Object.fromEntries(rejected), examples };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) throw new Error("Only --apply is supported");
  const apply = args.includes("--apply");
  const path = resolve(import.meta.dirname, "../../../../exports/restaurants.csv");
  const data = await profile(path); // Complete validation before opening a write connection.
  if (!process.env.NEON_DATABASE_URL) {
    throw new Error("NEON_DATABASE_URL is required; refusing to use a different database");
  }
  try {
    const client = await pool.connect();
    try {
      const before = Number((await client.query("SELECT count(*)::int AS total FROM restaurants")).rows[0].total);
      const rows = [...data.unique.values()];
      const ids = rows.map((row) => row.placeId);
      const existing = new Set<string>();
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const result = await client.query<{ place_id: string }>(
          "SELECT place_id FROM restaurants WHERE place_id = ANY($1::text[])", [ids.slice(i, i + BATCH_SIZE)],
        );
        result.rows.forEach((row) => existing.add(row.place_id));
      }
      let inserted = 0;
      if (apply) {
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          const params: unknown[] = [];
          const tuples = batch.map((row) => {
            const start = params.length;
            params.push(
              row.placeId, row.name, row.address, row.city, row.rating, row.website,
              row.googleMapsUrl, row.types, row.importedAt, restaurantSlug(row.name, row.placeId),
            );
            return `(${Array.from({ length: 10 }, (_, index) => `$${start + index + 1}`).join(",")},'historical_import','skipped')`;
          });
          // Never update an existing restaurant: live edits, claims and newer
          // metadata always win. The two explicit statuses exclude newly
          // recovered rows from automated outreach and enrichment.
          const result = await client.query(
            `INSERT INTO restaurants (place_id,name,address,city,rating,website,google_maps_url,types,imported_at,slug,outreach_status,enrichment_status)
             VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING RETURNING place_id`,
            params,
          );
          inserted += result.rowCount ?? 0;
        }
      }
      const presentAfter = new Set<string>();
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const result = await client.query<{ place_id: string }>(
          "SELECT place_id FROM restaurants WHERE place_id = ANY($1::text[])", [ids.slice(i, i + BATCH_SIZE)],
        );
        result.rows.forEach((row) => presentAfter.add(row.place_id));
      }
      const missingAfter = ids.filter((id) => !presentAfter.has(id));
      const after = Number((await client.query("SELECT count(*)::int AS total FROM restaurants")).rows[0].total);
      console.log(JSON.stringify({
        mode: apply ? "apply" : "dry-run",
        csvRows: data.rows, uniquePlaceIds: rows.length,
        duplicateRows: data.duplicateRows, conflictingDuplicates: data.conflictingDuplicates,
        rejectedRows: data.rejected, rejectionExamples: data.examples,
        before, matchedExisting: existing.size, missingBefore: rows.length - existing.size,
        inserted, after, expectedAfter: before + inserted,
        missingAfter: missingAfter.length, missingAfterPlaceIds: missingAfter.slice(0, 10),
      }, null, 2));
      if (after !== before + inserted) {
        throw new Error("Restaurant count changed unexpectedly during import; inspect concurrent writes");
      }
      if (apply && missingAfter.length) {
        throw new Error(`${missingAfter.length} restaurant(s) remain missing (e.g. a slug conflict); inspect the report`);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});