/**
 * Manual, opt-in grid crawler. No cron job is installed and this module is
 * never imported by the API server. See grid-crawl.md for invocation.
 */
import { readFile, writeFile, rename, open } from "node:fs/promises";
import { resolve } from "node:path";
import { parseGrid, gridHash, validateProgress, DAILY_GRID_LIMIT, DELAY_BETWEEN_REQUESTS_MS, type GridProgress } from "../lib/gridCrawlPlan";
import { cuisineFromRestaurantName } from "../lib/restaurantKeywords";
import { logger } from "../lib/logger";

const MASK = "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.location,places.websiteUri,places.googleMapsUri,places.types";
const COST_CENTS = 50; // Conservative estimate for the requested fields, not a guaranteed provider price.
const RESTAURANTS_PER_POINT = 10;

type Place = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  googleMapsUri?: string;
  types?: string[];
};

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

async function searchNearby(latitude: number, longitude: number, apiKey: string): Promise<Place[]> {
  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
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
  if (!response.ok) throw new Error(`Places Nearby search failed (${response.status}). Stop and inspect provider access before retrying.`);
  const payload = await response.json() as { places?: Place[] };
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
  logger.info({ total: points.length, next: progress.nextIndex, remainingToday: DAILY_GRID_LIMIT - progress.attemptedToday }, "Grid crawl plan");
  if (!options.confirm) return; // Default is dry-run. No DB connection or paid request.
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is required; no crawl was started.");
  if (progress.nextIndex >= points.length || progress.attemptedToday >= DAILY_GRID_LIMIT) return;

  // Dynamic imports keep dry-run free from database connections.
  const [{ db, restaurantsTable, restaurantImportRunsTable }, { sql, gte }, { restaurantSlug }] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
    import("../utils/slugify"),
  ]);
  const lock = await open(`${options.stateFile}.lock`, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error("Another crawl may be running. Inspect the lock before removing it.");
    throw error;
  });
  try {
    while (progress.nextIndex < points.length && progress.attemptedToday < DAILY_GRID_LIMIT) {
      const point = points[progress.nextIndex];
      const month = new Date();
      const monthStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
      const [usage] = await db.select({
        spent: sql<number>`coalesce(sum(${restaurantImportRunsTable.estimatedCostCents}), 0)`,
      }).from(restaurantImportRunsTable).where(gte(restaurantImportRunsTable.createdAt, monthStart));
      if (Number(usage?.spent ?? 0) + COST_CENTS > options.monthlyBudgetCents) {
        logger.info("Estimated monthly import budget reached; stopping.");
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
      const places = await searchNearby(point.latitude, point.longitude, apiKey);
      let imported = 0;
      for (const place of places) {
        if (!place.id || !place.displayName?.text || !place.formattedAddress) continue;
        const latitude = place.location?.latitude;
        const longitude = place.location?.longitude;
        if (typeof latitude !== "number" || typeof longitude !== "number") continue;
        const structuredCuisines = (place.types ?? [])
          .filter((type) => type.endsWith("_restaurant") && type !== "restaurant")
          .map((type) => type.replace(/_restaurant$/, "").replace(/_/g, " "));
        const cuisineTags = structuredCuisines.length
          ? structuredCuisines
          : cuisineFromRestaurantName(place.displayName.text);
        const [row] = await db.insert(restaurantsTable).values({
          placeId: place.id,
          name: place.displayName.text,
          address: place.formattedAddress,
          city: point.city,
          region: point.region,
          country: point.country,
          globalRegion: point.globalRegion,
          slug: restaurantSlug(place.displayName.text, place.id),
          rating: typeof place.rating === "number" ? place.rating : null,
          reviewCount: Number.isSafeInteger(place.userRatingCount) && place.userRatingCount! >= 0
            ? place.userRatingCount : null,
          priceLevel: place.priceLevel ?? null,
          latitude, longitude,
          currency: point.country === "USA" ? "USD" : point.country === "France" ? "EUR" : "GBP",
          cuisineTags,
          cuisines: cuisineTags,
          website: place.websiteUri ?? null,
          googleMapsUrl: place.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.id)}`,
          types: place.types ?? ["restaurant"],
        }).onConflictDoNothing({ target: restaurantsTable.placeId }).returning({ placeId: restaurantsTable.placeId });
        if (row) imported++;
      }
      progress.nextIndex++;
      await persistProgress(options.stateFile, progress);
      logger.info({ point: progress.nextIndex, total: points.length, found: places.length, imported }, "Grid point completed");
      if (progress.nextIndex < points.length && progress.attemptedToday < DAILY_GRID_LIMIT) {
        await new Promise((done) => setTimeout(done, DELAY_BETWEEN_REQUESTS_MS));
      }
    }
  } finally {
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