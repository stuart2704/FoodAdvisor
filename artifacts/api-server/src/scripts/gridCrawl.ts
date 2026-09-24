/**
 * A confirmed first run enables the UTC scheduler. Paid cursor and reservations
 * live in PostgreSQL; a failed/uncertain point cannot be retried automatically.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseGrid, gridHash, validateProgress, DAILY_GRID_LIMIT, EMERGENCY_RESERVE,
  DELAY_BETWEEN_REQUESTS_MS, MONTHLY_PAID_BUDGET_GBP, MONTHLY_PAID_LIMIT,
  ESTIMATED_GRID_REQUEST_COST_CENTS, computeRegionBudgets, computeRegionInterval,
  computeRegionPriority, computeCityBudgets,
  type GridPoint, type GridProgress,
} from "../lib/gridCrawlPlan";
import type { GridAllocations } from "../lib/gridCrawlRuntime";
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
    auto: args.includes("--auto"),
    skipUncertain: args.includes("--skip-uncertain"),
    plan: args.includes("--plan"),
    pause: args.includes("--pause"),
  };
}

function logDailyBudgetSummary(progress: GridProgress) {
  logEvent("daily_budget_summary", {
    total: DAILY_GRID_LIMIT,
    used: progress.attemptedToday,
    remaining: DAILY_GRID_LIMIT - progress.attemptedToday,
    scope: "utc_daily_grid_requests",
  });
}

async function allocationsForGrid(points: GridPoint[]): Promise<GridAllocations> {
  const [{ computeGridCrawlScores, loadGridCrawlAggregates }, { regionKey }] = await Promise.all([
    import("../lib/gridCrawlScores"),
    import("../lib/gridCrawlRuntime"),
  ]);
  const scores = computeGridCrawlScores(points, await loadGridCrawlAggregates(points));
  const regionBudgets = computeRegionBudgets(scores.regions);
  return Object.fromEntries(
    Object.entries(scores.regions).map(([region, metadata]) => {
      const cities = [...new Set(points.filter((point) => regionKey(point) === region)
        .map((point) => point.city))];
      return [region, {
        budget: regionBudgets[region],
        interval: computeRegionInterval(computeRegionPriority(metadata)),
        cities: computeCityBudgets(cities, Object.fromEntries(
          cities.map((city) => [city, scores.cities[`${region}/${city}`]]),
        ), regionBudgets[region]),
      }];
    }),
  );
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
  if (options.auto && !options.confirm) throw new Error("Automatic runs must be confirmed by the scheduler.");
  if (options.pause) {
    if (options.confirm || options.auto || options.plan || options.skipUncertain) {
      throw new Error("--pause must be used alone; it does not make a paid request.");
    }
    const runtime = await import("../lib/gridCrawlRuntime");
    return runtime.withGridCrawlLock(async () => {
      await runtime.pauseGridAutomation();
      logEvent("grid_crawl_automation_paused");
    });
  }
  if (options.gridFile === options.stateFile) throw new Error("Grid and progress files must differ.");
  const raw = await readFile(options.gridFile, "utf8");
  const points = parseGrid(JSON.parse(raw) as unknown);
  const hash = gridHash(raw);
  const today = new Date().toISOString().slice(0, 10);
  if (options.plan) {
    if (options.confirm || options.auto || options.skipUncertain) {
      throw new Error("--plan cannot be combined with --confirm or paid-run options.");
    }
    const runtime = await import("../lib/gridCrawlRuntime");
    return runtime.withGridCrawlLock(async () => {
      const state = await runtime.getGridRuntimeState();
      if (state.next_index >= points.length) throw new Error("Database cursor is beyond the grid.");
      const point = points[state.next_index];
      const region = runtime.regionKey(point);
      const followingCity = points.findIndex((candidate, index) =>
        index > state.next_index &&
        (runtime.regionKey(candidate) !== region || candidate.city !== point.city));
      const followingRegion = points.findIndex((candidate, index) =>
        index > state.next_index && runtime.regionKey(candidate) !== region);
      const allocations = await allocationsForGrid(points);
      const budget = state.grid_hash ? state.monthly_budget_cents : options.monthlyBudgetCents;
      const check = await runtime.reserveGridPoint(
        hash, state.next_index, point, followingCity === -1 ? points.length : followingCity,
        followingRegion === -1 ? points.length : followingRegion,
        points.length, allocations, budget, false, true,
      );
      logEvent("grid_crawl_plan", {
        total: points.length, next: state.next_index, allocations, check: check.status,
        simulated_only: true, paid_requests_made: 0,
      });
    });
  }
  if (options.skipUncertain) {
    if (!options.confirm || options.auto) {
      throw new Error("Skipping an uncertain charged point requires --skip-uncertain --confirm manually.");
    }
    const runtime = await import("../lib/gridCrawlRuntime");
    return runtime.withGridCrawlLock(async () => {
      const skipped = await runtime.skipUncertainGridPoint(hash, points);
      logEvent("grid_crawl_uncertain_point_skipped", { point: skipped, charged_reservation_retained: true });
    });
  }
  if (!options.confirm) {
    // Preserve validation of legacy file progress in offline previews. It is not
    // used for confirmed runs; their authoritative cursor is in PostgreSQL.
    let preview: GridProgress;
    try {
      preview = validateProgress(JSON.parse(await readFile(options.stateFile, "utf8")) as unknown, hash, points.length);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      preview = { version: 1, gridHash: hash, nextIndex: 0, date: today, attemptedToday: 0 };
    }
    logEvent("grid_crawl_plan", { total: points.length, next: preview.nextIndex,
      remainingToday: DAILY_GRID_LIMIT - preview.attemptedToday, mode: "offline_preview" });
    return;
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is required; no crawl was started.");
  const runtime = await import("../lib/gridCrawlRuntime");
  return runtime.withGridCrawlLock(async () => {
    const state = await runtime.getGridRuntimeState();
    if (options.auto && !state.automation_enabled) return;
    if (state.grid_hash && state.grid_hash !== hash) {
      throw new Error("Grid changed after paid work; inspect it before crawling.");
    }
    if (state.pending_index !== null) {
      throw new Error(`Point ${state.pending_index} has an uncertain paid reservation; no retry was made.`);
    }
    let progress = validateProgress({
      version: 1, gridHash: hash, nextIndex: state.next_index, date: today,
      attemptedToday: state.attempt_date === today ? state.attempted_today : 0,
    }, hash, points.length);
    logEvent("grid_crawl_plan", { total: points.length, next: progress.nextIndex,
      remainingToday: DAILY_GRID_LIMIT - progress.attemptedToday, mode: options.auto ? "automatic" : "manual" });
    if (progress.nextIndex >= points.length) throw new Error("Database cursor is beyond the grid; no request was made.");
    if (progress.attemptedToday >= DAILY_GRID_LIMIT) {
      logEvent("budget_exhausted", { remaining: 0, scope: "utc_daily_grid_requests" });
      logDailyBudgetSummary(progress);
      return;
    }
    const allocations = await allocationsForGrid(points);

  // Dynamic imports keep dry-run free from database connections.
  const [{ db, restaurantsTable }, { sql, eq, and, or, isNull, lt }, { restaurantSlug }] = await Promise.all([
    import("@workspace/db"),
    import("drizzle-orm"),
    import("../utils/slugify"),
  ]);
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
      const currentRegion = runtime.regionKey(point);
      const followingCity = points.findIndex((candidate, index) =>
        index > progress.nextIndex &&
        (runtime.regionKey(candidate) !== currentRegion || candidate.city !== point.city));
      const nextCityIndex = followingCity === -1 ? points.length : followingCity;
      const followingRegion = points.findIndex((candidate, index) =>
        index > progress.nextIndex && runtime.regionKey(candidate) !== currentRegion);
      const nextRegionIndex = followingRegion === -1 ? points.length : followingRegion;
      const reservation = await runtime.reserveGridPoint(
        hash, progress.nextIndex, point, nextCityIndex, nextRegionIndex, points.length, allocations,
        options.monthlyBudgetCents, options.auto,
      );
      if (reservation.status === "not_due") {
        progress.nextIndex = nextRegionIndex;
        continue;
      }
      if (reservation.status !== "reserved") {
        const reason = reservation.status;
        if (reason === "region" || reason === "city") {
          logEvent(`${reason}_budget_exceeded`, {
            region: currentRegion, city: point.city,
            budget: reservation.budget, used: reservation.used,
          });
          progress.nextIndex = reservation.nextIndex;
          continue;
        } else if (reason === "daily") {
          logEvent("budget_exhausted", { remaining: 0, scope: "utc_daily_grid_requests" });
        } else if (reason === "monthly") {
          logEvent("paid_budget_exceeded", { configured_limit_cents: options.monthlyBudgetCents });
        }
        logEvent("grid_crawl_budget_reached", { reason });
        break;
      }
      const usedRequests = reservation.usedRequests;
      progress.attemptedToday = reservation.attemptedToday;
      logEvent("paid_budget_status", {
        budget_gbp: options.monthlyBudgetCents / 100,
        max_budget_gbp: MONTHLY_PAID_BUDGET_GBP,
        limit_requests: MONTHLY_PAID_LIMIT,
        used_requests: usedRequests,
        remaining_requests: Math.max(0, Math.min(
          MONTHLY_PAID_LIMIT - usedRequests,
          Math.floor((options.monthlyBudgetCents - reservation.spentCents) / ESTIMATED_GRID_REQUEST_COST_CENTS),
        )),
        estimated_spent_cents: reservation.spentCents,
        phase: "before_request",
      });
      logEvent("region_budget_status", {
        region: currentRegion, budget: reservation.regionBudget,
        used: reservation.regionUsed, remaining: reservation.regionBudget - reservation.regionUsed,
      });
      logEvent("city_budget_status", {
        region: currentRegion, city: point.city, budget: reservation.cityBudget,
        used: reservation.cityUsed, remaining: reservation.cityBudget - reservation.cityUsed,
      });
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
      const completedIndex = progress.nextIndex;
      const gridCompleted = completedIndex + 1 === points.length;
      await runtime.completeGridPoint(
        hash, completedIndex, point, completedIndex + 1,
        completedIndex + 1 === nextRegionIndex, gridCompleted,
      );
      progress.nextIndex = completedIndex + 1;
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
  }
  });
}

if (process.argv[1] && /[/\\]src[/\\]scripts[/\\]gridCrawl\.ts$/.test(resolve(process.argv[1]))) {
  runDailyCrawl(process.argv.slice(2)).catch((error: unknown) => {
    logger.error({ err: error }, "Grid crawl stopped");
    process.exitCode = 1;
  });
}