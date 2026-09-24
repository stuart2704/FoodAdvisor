/**
 * Manual, opt-in grid crawler. No cron job is installed and this module is
 * never imported by the API server. See grid-crawl.md for invocation.
 */
import { readFile, writeFile, rename, open } from "node:fs/promises";
import { resolve } from "node:path";
import { parseGrid, gridHash, validateProgress, DAILY_GRID_LIMIT, EMERGENCY_RESERVE, DELAY_BETWEEN_REQUESTS_MS, ESTIMATED_GRID_REQUEST_COST_CENTS, MONTHLY_PAID_BUDGET_GBP, MONTHLY_PAID_LIMIT, paidGridBudgetReached, type GridProgress } from "../lib/gridCrawlPlan";
import { normaliseCoordinates } from "../lib/geo";
import { verifiedExistingFields, type NearbyPlace } from "../lib/gridPlaceFields";
import { cuisineFromRestaurantName } from "../lib/restaurantKeywords";
import { missingFieldNames, stalenessReasons, STALE_AFTER_MS, STALE_RATING_CHANGE, STALE_REVIEW_JUMP } from "../lib/gridStaleness";
import { classifyGridPriority, PRIORITY } from "../lib/gridPriority";
import { logEvent } from "../lib/logEvent";
import { logger } from "../lib/logger";

const MASK = "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.location,places.websiteUri,places.googleMapsUri,places.types";
const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";
const RESTAURANTS_PER_POINT = 10;

function argumentsForRun(args: string[]) {
  const option = (name: string) => args[args.indexOf(name) + 1];
  const gridFile = args.includes("--grid") ? option("--grid") : undefined;
  const stateFile = args.includes("--state") ? option("--state") : undefined;
  if (!gridFile || gridFile.startsWith("--")) throw new Error("Pass --grid /path/to/coordinates.json.");
  if (!stateFile || stateFile.startsWith("--")) throw new Error("Pass --state /path/to/progress.json on persistent storage.");
  const budget = args.includes("--monthly-budget-cents") ? Number(option("--monthly-budget-cents")) : NaN;
  if (!Number.isSafeInteger(budget) || budget < ESTIMATED_GRID_REQUEST_COST_CENTS ||
      budget > MONTHLY_PAID_BUDGET_GBP * 100) {
    throw new Error(`Pass --monthly-budget-cents between ${ESTIMATED_GRID_REQUEST_COST_CENTS} and ${MONTHLY_PAID_BUDGET_GBP * 100}; this is an estimated cap, not a billing cap.`);
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

function logDailyBudgetSummary(progress: GridProgress) {
  logEvent("daily_budget_summary", {
    total: DAILY_GRID_LIMIT,
    used: progress.attemptedToday,
    remaining: DAILY_GRID_LIMIT - progress.attemptedToday,
    scope: "utc_daily_grid_requests",
  });
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
  if (progress.nextIndex >= points.length) {
    logDailyBudgetSummary(progress);
    return;
  }
  if (progress.attemptedToday >= DAILY_GRID_LIMIT) {
    logEvent("budget_exhausted", { remaining: 0, scope: "utc_daily_grid_requests" });
    logDailyBudgetSummary(progress);
    return;
  }

  // Dynamic imports keep dry-run free from database connections.
  const [{ db, restaurantsTable, restaurantImportRunsTable }, { sql, gte, eq, and, or, isNull, lt }, { restaurantSlug }] = await Promise.all([
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
  let activeRegion: string | null = null;
  let pointsCrawledInRegion = 0;
  let lastCompletedIndex = progress.nextIndex - 1;
  try {
    while (progress.nextIndex < points.length && progress.attemptedToday < DAILY_GRID_LIMIT) {
      const point = points[progress.nextIndex];
      const month = new Date();
      const monthStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
      const [usage] = await db.select({
        spent: sql<number>`coalesce(sum(${restaurantImportRunsTable.estimatedCostCents}), 0)`,
        calls: sql<number>`coalesce(sum(${restaurantImportRunsTable.apiCalls}), 0)`,
      }).from(restaurantImportRunsTable).where(gte(restaurantImportRunsTable.createdAt, monthStart));
      const spentCents = Number(usage?.spent ?? 0);
      const usedRequests = Number(usage?.calls ?? 0);
      const budgetReached = paidGridBudgetReached(spentCents, usedRequests, options.monthlyBudgetCents);
      logEvent("paid_budget_status", {
        budget_gbp: options.monthlyBudgetCents / 100,
        max_budget_gbp: MONTHLY_PAID_BUDGET_GBP,
        limit_requests: MONTHLY_PAID_LIMIT,
        used_requests: usedRequests,
        remaining_requests: Math.max(0, Math.min(
          MONTHLY_PAID_LIMIT - usedRequests,
          Math.floor((options.monthlyBudgetCents - spentCents) / ESTIMATED_GRID_REQUEST_COST_CENTS),
        )),
        estimated_spent_cents: spentCents,
        phase: "before_request",
      });
      if (budgetReached) {
        logEvent("paid_budget_exceeded", {
          limit_gbp: MONTHLY_PAID_BUDGET_GBP,
          limit_requests: MONTHLY_PAID_LIMIT,
          used: usedRequests,
          estimated_spent_cents: spentCents,
          configured_limit_cents: options.monthlyBudgetCents,
        });
        logEvent("grid_crawl_budget_reached");
        break;
      }
      // Reserve before calling Google: on an uncertain failure the reservation
      // remains and the point is not advanced, avoiding an untracked retry.
      await db.insert(restaurantImportRunsTable).values({
        cities: [point.city], requested: RESTAURANTS_PER_POINT, imported: 0, skippedDuplicates: 0,
        apiCalls: 1, estimatedCostCents: ESTIMATED_GRID_REQUEST_COST_CENTS, monthlyBudgetCents: options.monthlyBudgetCents,
        stoppedBecause: `Grid request reserved at point ${progress.nextIndex}`,
      });
      progress.attemptedToday += 1;
      await persistProgress(options.stateFile, progress);
      logEvent("budget_used", {
        remaining: DAILY_GRID_LIMIT - progress.attemptedToday,
        scope: "utc_daily_grid_requests",
      });
      logEvent("budget_status", {
        used: progress.attemptedToday,
        remaining: DAILY_GRID_LIMIT - progress.attemptedToday,
        reserve_target: EMERGENCY_RESERVE,
        reserve_enforced: false,
        scope: "utc_daily_grid_requests",
      });
      const currentRegion = point.globalRegion.toLowerCase().replace(/\s+/g, "_");
      if (activeRegion !== currentRegion) {
        if (activeRegion !== null) {
          logEvent("region_end", { region: activeRegion, points_crawled: pointsCrawledInRegion, completed: true });
        }
        activeRegion = currentRegion;
        pointsCrawledInRegion = 0;
        logEvent("region_start", { region: currentRegion });
      }
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
        const [existing] = await db.select({
          name: restaurantsTable.name,
          placeId: restaurantsTable.placeId,
          updatedAt: restaurantsTable.updatedAt,
          rating: restaurantsTable.rating,
          reviewCount: restaurantsTable.reviewCount,
          address: restaurantsTable.address,
          cuisines: restaurantsTable.cuisines,
          amenities: restaurantsTable.amenities,
          priceLevel: restaurantsTable.priceLevel,
          website: restaurantsTable.website,
        }).from(restaurantsTable).where(eq(restaurantsTable.placeId, place.id)).limit(1);
        if (!existing) continue;

        const missing = missingFieldNames(existing);
        if (missing.length) {
          logEvent("missing_fields_detected", { name: existing.name, missing });
        }
        const now = new Date();
        const reasons = stalenessReasons(existing, fields, now);
        const fillableMissing = reasons.some((reason) => reason.startsWith("missing_"));
        const priority = classifyGridPriority(existing, fields, now);
        logEvent("crawl_priority", {
          name: existing.name,
          priority,
          priority_label: Object.entries(PRIORITY).find(([, value]) => value === priority)?.[0].toLowerCase(),
          update_eligible: reasons.length > 0,
        });
        logEvent("budget_priority", {
          name: existing.name,
          priority,
          used: usedRequests + 1, // The current grid request was reserved before this result.
          limit: MONTHLY_PAID_LIMIT,
          phase: "after_grid_request",
        });
        if (!reasons.length) {
          summary.skips++;
          logEvent("skip_not_stale", { name: existing.name, place_id: existing.placeId });
          logEvent("skip_fresh", { name: existing.name, place_id: existing.placeId });
          if (existing.updatedAt && existing.updatedAt.getTime() > now.getTime() - STALE_AFTER_MS) {
            logEvent("skip_recent", { name: existing.name, place_id: existing.placeId });
          }
          continue;
        }

        // Recheck the full eligibility condition atomically at write time:
        // another crawler may have refreshed this row since the read above.
        const staleConditions = [
          isNull(restaurantsTable.updatedAt),
          lt(restaurantsTable.updatedAt, new Date(now.getTime() - STALE_AFTER_MS)),
        ];
        if (fields.rating !== undefined) {
          staleConditions.push(sql`(${restaurantsTable.rating} IS NOT NULL AND
            ABS(${restaurantsTable.rating}::numeric - ${fields.rating}::numeric) > ${STALE_RATING_CHANGE}::numeric)`);
        }
        if (fields.reviewCount !== undefined) {
          staleConditions.push(sql`(${restaurantsTable.reviewCount} IS NOT NULL AND
            ${fields.reviewCount}::integer - ${restaurantsTable.reviewCount} > ${STALE_REVIEW_JUMP})`);
        }
        if (fields.address) {
          staleConditions.push(sql`btrim(${restaurantsTable.address}) = ''`);
        }
        if (fields.cuisines?.length) {
          staleConditions.push(sql`coalesce(cardinality(${restaurantsTable.cuisines}), 0) = 0`);
        }
        if (fields.priceLevel) {
          staleConditions.push(sql`(${restaurantsTable.priceLevel} IS NULL OR btrim(${restaurantsTable.priceLevel}) = '')`);
        }
        if (fields.website) {
          staleConditions.push(sql`(${restaurantsTable.website} IS NULL OR btrim(${restaurantsTable.website}) = '')`);
        }
        const [row] = await db.update(restaurantsTable)
          .set({ ...fields, updatedAt: now })
          .where(and(
            eq(restaurantsTable.placeId, place.id),
            or(...staleConditions),
          ))
          .returning({ placeId: restaurantsTable.placeId, name: restaurantsTable.name });
        if (row) {
          refreshed++;
          summary.updates++;
          logEvent("stale_detected", { name: existing.name, place_id: existing.placeId, reason: reasons.join("/") });
          logEvent("update_stale", { name: row.name, place_id: row.placeId });
          logEvent("update_recovery", { name: row.name, reason: fillableMissing ? "missing_fields" : "stale" });
          logEvent("update_mode", { name: row.name, mode: fillableMissing ? "recovery" : "stale" });
          logEvent("update", { name: row.name, place_id: row.placeId });
        } else {
          const [latest] = await db.select({
            name: restaurantsTable.name,
            placeId: restaurantsTable.placeId,
            updatedAt: restaurantsTable.updatedAt,
            rating: restaurantsTable.rating,
            reviewCount: restaurantsTable.reviewCount,
            address: restaurantsTable.address,
            cuisines: restaurantsTable.cuisines,
            priceLevel: restaurantsTable.priceLevel,
            website: restaurantsTable.website,
          }).from(restaurantsTable).where(eq(restaurantsTable.placeId, place.id)).limit(1);
          if (latest && !stalenessReasons(latest, fields).length) {
            summary.skips++;
            logEvent("skip_not_stale", { name: latest.name, place_id: latest.placeId });
          }
        }
      }
      progress.nextIndex++;
      await persistProgress(options.stateFile, progress);
      lastCompletedIndex = progress.nextIndex - 1;
      summary.points_crawled++;
      pointsCrawledInRegion++;
      logEvent("grid_crawl_point_completed", { point: progress.nextIndex, total: points.length, found: places.length, imported, refreshed });
      if (progress.nextIndex < points.length && progress.attemptedToday < DAILY_GRID_LIMIT) {
        logEvent("grid_crawl_wait", { delaySeconds: DELAY_BETWEEN_REQUESTS_MS / 1000 });
        await new Promise((done) => setTimeout(done, DELAY_BETWEEN_REQUESTS_MS));
      }
    }
    if (progress.nextIndex < points.length && progress.attemptedToday >= DAILY_GRID_LIMIT) {
      logEvent("budget_exhausted", { remaining: 0, scope: "utc_daily_grid_requests" });
    }
  } catch (error) {
    summary.errors++;
    throw error;
  } finally {
    if (activeRegion !== null) {
      const nextPoint = points[lastCompletedIndex + 1];
      const completed = !nextPoint || nextPoint.globalRegion.toLowerCase().replace(/\s+/g, "_") !== activeRegion;
      logEvent("region_end", { region: activeRegion, points_crawled: pointsCrawledInRegion, completed });
    }
    logEvent("daily_summary", summary);
    logEvent("crawler_health", {
      delay_ms: DELAY_BETWEEN_REQUESTS_MS,
      attempted_today: progress.attemptedToday,
      next_index: progress.nextIndex,
      errors_this_run: summary.errors,
    });
    logDailyBudgetSummary(progress);
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