/**
 * Manual, opt-in grid crawler. No cron job is installed and this module is
 * never imported by the API server. See grid-crawl.md for invocation.
 */
import { readFile, writeFile, rename, open } from "node:fs/promises";
import { resolve } from "node:path";
import { parseGrid, gridHash, validateProgress, DAILY_GRID_LIMIT, DELAY_BETWEEN_REQUESTS_MS, type GridProgress } from "../lib/gridCrawlPlan";
import { normaliseCoordinates } from "../lib/geo";
import { verifiedExistingFields, type NearbyPlace } from "../lib/gridPlaceFields";
import { cuisineFromRestaurantName } from "../lib/restaurantKeywords";
import { logEvent } from "../lib/logEvent";
import { logger } from "../lib/logger";

const MASK = "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.location,places.websiteUri,places.googleMapsUri,places.types";
const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";
const COST_CENTS = 50; // Conservative estimate for the requested fields, not a guaranteed provider price.
const RESTAURANTS_PER_POINT = 10;

const REFRESH_AFTER_MS = 720 * 60 * 60 * 1000;

function argumentsForRun(args: string[]) {
  const option = (name: string) => args[args.indexOf(name) + 1];
  const gridFile = args.includes("--grid") ? option("--grid") : undefined;
  const stateFile = args.includes("--state") ? option("--state") : undefined;
  if (!gridFile || gridFile.startsWith("--")) throw new Error("Pass --grid /path/to/coordinates.json.");
  if (!stateFile || stateFile.startsWith("--")) throw new Error("Pass --state /path/to/progress.json on persistent storage.");
  const budget = args.includes("--monthly-budget-cents") ? Number(option("--monthly-budget-cents")) : NaN;
  if (!Number.isSafeInteger(budget) || budget < COST_CENTS) {
    throw new Error("Pass a positive --monthly-budget-cents; this is an estimated cap, not a billing cap.");
  }
  return {
    gridFile: resolve(gridFile),
    stateFile: resolve(stateFile),
    monthlyBudgetCents: budget,
    confirm: args.includes("--confirm"),
  };
}

async function persistProgress(path: string, progress: GridProgress) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(progress, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await rename(temporary, path);
}

async function searchNearby(latitude: number, longitude: number, apiKey: string): Promise<NearbyPlace[]> {
  let response: Response;
  try {
    response = await fetch(PLACES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": MASK },
      body: JSON.stringify({
        includedTypes: ["restaurant"],
        maxResultCount: RESTAURANTS_PER_POINT,
        locationRestriction: { circle: { center: { latitude, longitude }, radius: 1500 } },
        languageCode: "en",
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    logEvent("fetch_error", { url: PLACES_URL });
    throw error;
  }
  if (!response.ok) {
    logEvent("places_request_failed", { status: response.status });
    throw new Error(`Places Nearby search failed (${response.status}). Stop and inspect provider access before retrying.`);
  }
  const payload = await response.json() as { places?: NearbyPlace[] };
  if (payload.places !== undefined && !Array.isArray(payload.places)) throw new Error("Invalid Places response.");
  return payload.places ?? [];
}

export async function runDailyCrawl(args: string[]) {
  const options = argumentsForRun(args);
  if (options.gridFile === options.stateFile) throw new Error("Grid and progress files must differ.");
  const raw = await readFile(options.gridFile, "utf8");
  const points = parseGrid(JSON.parse(raw) as unknown);
  const hash = gridHash(raw);
  const today = new Date().toISOString().slice(0, 10);
  let progress: GridProgress;
  try {
    progress = validateProgress(JSON.parse(await readFile(options.stateFile, "utf8")) as unknown, hash, points.length);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    progress = { version: 1, gridHash: hash, nextIndex: 0, date: today, attemptedToday: 0 };
  }
  if (progress.date > today) throw new Error("Progress date is in the future; check your system clock.");
  if (progress.date !== today) progress = { ...progress, date: today, attemptedToday: 0 };
  logEvent("grid_crawl_plan", { total: points.length, next: progress.nextIndex, remainingToday: DAILY_GRID_LIMIT - progress.attemptedToday });
  if (!options.confirm) return; // Default is dry-run. No DB connection or paid request.
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is required; no crawl was started.");
  if (progress.nextIndex >= points.length || progress.attemptedToday >= DAILY_GRID_LIMIT) return;

  // Dynamic imports keep dry-run free from database connections.
  const [{ db, restaurantsTable, restaurantImportRunsTable }, { sql, gte, eq, and, or, isNull, lte }, { restaurantSlug }] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
    import("../utils/slugify"),
  ]);
  const lock = await open(`${options.stateFile}.lock`, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error("Another crawl may be running. Inspect the lock before removing it.");
    throw error;
  });
  const summary = {
    points_crawled: 0,
    inserts: 0,
    updates: 0,
    skips: 0,
    errors: 0,
    period: "this_run",
  };
  try {
    while (progress.nextIndex < points.length && progress.attemptedToday < DAILY_GRID_LIMIT) {
      const point = points[progress.nextIndex];
      const month = new Date();
      const monthStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
      const [usage] = await db.select({
        spent: sql<number>`coalesce(sum(${restaurantImportRunsTable.estimatedCostCents}), 0)`,
      }).from(restaurantImportRunsTable).where(gte(restaurantImportRunsTable.createdAt, monthStart));
      if (Number(usage?.spent ?? 0) + COST_CENTS > options.monthlyBudgetCents) {
        logEvent("grid_crawl_budget_reached");
        break;
      }
      // Reserve before calling Google: on an uncertain failure the reservation
      // remains and the point is not advanced, avoiding an untracked retry.
      await db.insert(restaurantImportRunsTable).values({
        cities: [point.city], requested: RESTAURANTS_PER_POINT, imported: 0, skippedDuplicates: 0,
        apiCalls: 1, estimatedCostCents: COST_CENTS, monthlyBudgetCents: options.monthlyBudgetCents,
        stoppedBecause: `Grid request reserved at point ${progress.nextIndex}`,
      });
      progress.attemptedToday += 1;
      await persistProgress(options.stateFile, progress);
      logEvent("crawl_point", {
        region: point.region,
        city: point.city,
        lat: point.latitude,
        lng: point.longitude,
      });
      const places = await searchNearby(point.latitude, point.longitude, apiKey);
      logEvent("cards_found", { count: places.length });
      let imported = 0;
      let refreshed = 0;
      for (const place of places) {
        if (!place.id) continue;
        const fields = verifiedExistingFields(place);
        if (!Object.keys(fields).length) continue;
        const coordinates = normaliseCoordinates(place.location);
        if (fields.name && fields.address && coordinates) {
          const cuisineTags = fields.cuisineTags ?? cuisineFromRestaurantName(fields.name);
          const [row] = await db.insert(restaurantsTable).values({
            placeId: place.id,
            name: fields.name,
            address: fields.address,
            city: point.city,
            region: point.region,
            country: point.country,
            globalRegion: point.globalRegion,
            slug: restaurantSlug(fields.name, place.id),
            rating: fields.rating ?? null,
            reviewCount: fields.reviewCount ?? null,
            priceLevel: fields.priceLevel ?? null,
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            currency: point.country === "USA" ? "USD" : point.country === "France" ? "EUR" : "GBP",
            cuisineTags,
            cuisines: cuisineTags,
            website: fields.website ?? null,
            googleMapsUrl: place.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.id)}`,
            types: place.types?.filter((type) => typeof type === "string" && type.length > 0) ?? ["restaurant"],
          }).onConflictDoNothing({ target: restaurantsTable.placeId }).returning({
            placeId: restaurantsTable.placeId,
            name: restaurantsTable.name,
          });
          if (row) {
            imported++;
            summary.inserts++;
            logEvent("insert", { name: row.name, place_id: row.placeId });
            continue;
          }
        }
        // Conflict and freshness check are atomic: a concurrent insert or
        // refresh cannot be overwritten by an earlier existence check.
        const [row] = await db.update(restaurantsTable)
          .set({ ...fields, updatedAt: new Date() })
          .where(and(
            eq(restaurantsTable.placeId, place.id),
            or(
              isNull(restaurantsTable.updatedAt),
              lte(restaurantsTable.updatedAt, new Date(Date.now() - REFRESH_AFTER_MS)),
            ),
          ))
          .returning({ placeId: restaurantsTable.placeId, name: restaurantsTable.name });
        if (row) {
          refreshed++;
          summary.updates++;
          logEvent("update", { name: row.name, place_id: row.placeId });
        } else {
          const [existing] = await db.select({
            name: restaurantsTable.name,
            placeId: restaurantsTable.placeId,
            updatedAt: restaurantsTable.updatedAt,
          }).from(restaurantsTable).where(eq(restaurantsTable.placeId, place.id)).limit(1);
          if (existing?.updatedAt && existing.updatedAt.getTime() > Date.now() - REFRESH_AFTER_MS) {
            summary.skips++;
            logEvent("skip_recent", { name: existing.name, place_id: existing.placeId });
          }
        }
      }
      progress.nextIndex++;
      await persistProgress(options.stateFile, progress);
      summary.points_crawled++;
      logEvent("grid_crawl_point_completed", { point: progress.nextIndex, total: points.length, found: places.length, imported, refreshed });
      if (progress.nextIndex < points.length && progress.attemptedToday < DAILY_GRID_LIMIT) {
        logEvent("grid_crawl_wait", { delaySeconds: DELAY_BETWEEN_REQUESTS_MS / 1000 });
        await new Promise((done) => setTimeout(done, DELAY_BETWEEN_REQUESTS_MS));
      }
    }
  } catch (error) {
    summary.errors++;
    throw error;
  } finally {
    logEvent("daily_summary", summary);
    logEvent("crawler_health", {
      delay_ms: DELAY_BETWEEN_REQUESTS_MS,
      attempted_today: progress.attemptedToday,
      next_index: progress.nextIndex,
      errors_this_run: summary.errors,
    });
    await lock.close();
    const { unlink } = await import("node:fs/promises");
    await unlink(`${options.stateFile}.lock`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  runDailyCrawl(process.argv.slice(2)).catch((error: unknown) => {
    logger.error({ err: error }, "Grid crawl stopped");
    process.exitCode = 1;
  });
}