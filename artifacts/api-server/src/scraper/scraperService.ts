import { scrapeMapsForCity, type MapsRestaurant, type MapsScanOptions } from "./mapsScraper";
import {
  enrichRestaurant,
  type RestaurantEnrichmentResult,
} from "../services/enrichment/enrichRestaurant";
import { logEvent } from "../utils/eventLog";
import { validateRestaurant } from "./validator";
import { dedupeRestaurants } from "./dedupeService";
import { classifyScraperError } from "../errors/errorService";
import { getScalingLimits, limitRestaurants } from "../scaling/scalingService";
import { recordCityHealth } from "../health/recordCityHealth";

export type ScrapeCityOptions = MapsScanOptions & { engine?: "places" | "playwright" };
import type { BrowserCityResult } from "./playwright/browserCityService";

export type ScrapedRestaurant = MapsRestaurant & {
  scrapedAt: string;
  enrichment: RestaurantEnrichmentResult
    | { ok: false; error: { code: "enrichment_failed"; message: string } }
    | { skipped: true; reason: "website_missing" };
};

/**
 * Uses the official Places API by default. Browser mode is explicitly opt-in.
 * The existing import service persists and deduplicates listings before
 * enrichment. Do not insert the returned restaurants again in a second queue.
 * No paid work happens on import, and callers must explicitly confirm a scan.
 */
export function scrapeCity(
  city: string,
  options: ScrapeCityOptions & { engine: "playwright" },
): Promise<BrowserCityResult>;
export function scrapeCity(
  city: string,
  options?: MapsScanOptions & { engine?: "places" },
): Promise<ScrapedRestaurant[]>;
export async function scrapeCity(
  city: string,
  options: ScrapeCityOptions = { confirm: false },
): Promise<ScrapedRestaurant[] | BrowserCityResult> {
  const requestedLimit = options.perCityLimit ?? 10;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error("City scan limit must be a positive safe integer.");
  }
  const health = { city, confirmed: options.confirm === true, browser: options.engine === "playwright", startedAt: Date.now() };
  if (options.engine === "playwright") {
    try {
      const { scrapeBrowserCity } = await import("./playwright/browserCityService");
      const result = await scrapeBrowserCity(city, options);
      recordCityHealth({ ...health, mapsSuccess: true, restaurants: result.restaurants, unresolved: result.unresolved.length });
      return result;
    } catch (error) {
      recordCityHealth({ ...health, mapsSuccess: false, error });
      throw error;
    }
  }
  if (options.engine !== undefined && options.engine !== "places") {
    throw new Error("Unsupported scraper engine.");
  }
  logEvent("info", "City scraper started");
  let mapsSuccess = false;
  try {
    // Limit the paid request itself, not just its already-persisted results.
    const mapsResults = await scrapeMapsForCity(city, {
      ...options,
      perCityLimit: Math.min(requestedLimit, getScalingLimits().MAX_RESTAURANTS_PER_CITY),
    });
    mapsSuccess = true;
    const limited = limitRestaurants(mapsResults);
    const enrichedRestaurants: ScrapedRestaurant[] = [];
    let invalid = 0;
    let enrichmentFailures = 0;
    const validated = limited.filter((restaurant) => {
      if (!validateRestaurant(restaurant)) {
        invalid += 1;
        logEvent("warning", "Invalid restaurant omitted from scrape output; imported data may already be stored");
        return false;
      }
      return true;
    });
    const unique = dedupeRestaurants(validated);
    const duplicates = validated.length - unique.length;
    for (const restaurant of unique) {
      let enrichment: ScrapedRestaurant["enrichment"] = {
        skipped: true,
        reason: "website_missing",
      };
      if (restaurant.website) {
        try {
          // Reuse bounded website requests and private-network protections.
          enrichment = await enrichRestaurant(restaurant.id);
          logEvent(enrichment.ok ? "success" : "warning",
            enrichment.ok ? "Restaurant website enriched" : `Website enrichment failed (${enrichment.error.code})`);
        } catch {
          enrichment = {
            ok: false,
            error: {
              code: "enrichment_failed",
              message: "Website enrichment could not be completed.",
            },
          };
          logEvent("error", "Website enrichment failed; listing retained");
        }
        if ("ok" in enrichment && !enrichment.ok) enrichmentFailures += 1;
      }
      // Keep canonical Maps fields separate from untrusted website data.
      enrichedRestaurants.push({
        ...restaurant,
        enrichment,
        scrapedAt: new Date().toISOString(),
      });
    }
    if (limited.length > 0 && enrichedRestaurants.length === 0) {
      throw new Error("No valid restaurant results.");
    }
    logEvent(invalid || enrichmentFailures ? "warning" : "success",
      `City scan finished: ${enrichedRestaurants.length} unique results, ${duplicates} duplicates, ${invalid} invalid, ${enrichmentFailures} enrichment failures`);
    recordCityHealth({ ...health, mapsSuccess, restaurants: enrichedRestaurants, unresolved: invalid });
    return enrichedRestaurants;
  } catch (error) {
    recordCityHealth({ ...health, mapsSuccess, error });
    logEvent("error", "City scan or enrichment phase failed", classifyScraperError(error));
    throw new Error("City scan failed; some listings may already have been saved. Check import status before retrying.");
  }
}