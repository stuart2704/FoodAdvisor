import { scrapeMapsResults, type MapsRestaurant, type MapsScanOptions } from "./mapsScraper";
import {
  enrichRestaurant,
  type RestaurantEnrichmentResult,
} from "../services/enrichment/enrichRestaurant";
import { logEvent } from "../utils/eventLog";

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
  const mapsResults = await scrapeMapsResults(city, options);
  try {
    const enrichedRestaurants: ScrapedRestaurant[] = [];
    for (const restaurant of mapsResults) {
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
      }
      // Keep canonical Maps fields separate from untrusted website data.
      enrichedRestaurants.push({
        ...restaurant,
        enrichment,
        scrapedAt: new Date().toISOString(),
      });
    }
    logEvent("success", "City scan and enrichment finished");
    return enrichedRestaurants;
  } catch {
    logEvent("error", "City enrichment phase failed");
    throw new Error("City scan failed; some listings may already have been saved. Check import status before retrying.");
  }
}