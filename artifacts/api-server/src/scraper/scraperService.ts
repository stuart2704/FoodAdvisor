import { scrapeMapsForCity, type MapsRestaurant, type MapsScanOptions } from "./mapsScraper";
import {
  enrichRestaurant,
  type RestaurantEnrichmentResult,
} from "../services/enrichment/enrichRestaurant";
import { logEvent } from "../utils/eventLog";
import { validateRestaurant } from "./validator";
import { classifyScraperError } from "../errors/errorService";
import { getScalingLimits, limitRestaurants } from "../scaling/scalingService";

export type ScrapeCityOptions = MapsScanOptions;

export type ScrapedRestaurant = MapsRestaurant & {
  scrapedAt: string;
  enrichment: RestaurantEnrichmentResult
    | { ok: false; error: { code: "enrichment_failed"; message: string } }
    | { skipped: true; reason: "website_missing" };
};

/**
 * Uses the official Places API, not Google Maps HTML scraping.
 * The existing import service persists and deduplicates listings before
 * enrichment. Do not insert the returned restaurants again in a second queue.
 * No paid work happens on import, and callers must explicitly confirm a scan.
 */
export async function scrapeCity(
  city: string,
  options: ScrapeCityOptions = { confirm: false },
): Promise<ScrapedRestaurant[]> {
  const requestedLimit = options.perCityLimit ?? 10;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error("City scan limit must be a positive safe integer.");
  }
  logEvent("info", "City scraper started");
  try {
    // Limit the paid request itself, not just its already-persisted results.
    const mapsResults = await scrapeMapsForCity(city, {
      ...options,
      perCityLimit: Math.min(requestedLimit, getScalingLimits().MAX_RESTAURANTS_PER_CITY),
    });
    const limited = limitRestaurants(mapsResults);
    const seen = new Set<string>();
    const enrichedRestaurants: ScrapedRestaurant[] = [];
    let invalid = 0;
    let duplicates = 0;
    let enrichmentFailures = 0;
    for (const restaurant of limited) {
      if (!validateRestaurant(restaurant)) {
        invalid += 1;
        logEvent("warning", "Invalid restaurant omitted from scrape output; imported data may already be stored");
        continue;
      }
      // Check only this batch. Looking up duplicates in Neon here would reject
      // every result, because the Maps importer already inserted these records.
      if (seen.has(restaurant.id)) {
        duplicates += 1;
        continue;
      }
      seen.add(restaurant.id);
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
    return enrichedRestaurants;
  } catch (error) {
    logEvent("error", "City scan or enrichment phase failed", classifyScraperError(error));
    throw new Error("City scan failed; some listings may already have been saved. Check import status before retrying.");
  }
}