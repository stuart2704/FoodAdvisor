import { scrapeMaps, type MapsDiscovery } from "./mapsScraper.playwright";
import { scrapeWebsite, type BrowserWebsiteData } from "./websiteScraper.playwright";
import { validateRestaurant } from "../validator";
import { dedupeRestaurants } from "../dedupeService";
import { queueForInsertion } from "../../pipeline/insertService";
import { logEvent } from "../../utils/eventLog";

export interface BrowserCityResult {
  source: "playwright";
  persisted: false;
  queuedCount: number;
  restaurants: Array<MapsDiscovery & {
    enrichment: BrowserWebsiteData | { skipped: true } | { error: "website_extraction_failed" };
  }>;
  unresolved: MapsDiscovery[];
}

/**
 * Separate staging path: browser discoveries have not been inserted by Places.
 * Only records with explicit canonical IDs and required fields may be queued.
 * Proxy charges are not measured by the Google Places API spending ledger.
 */
export async function scrapeBrowserCity(
  city: string,
  options: { confirm: boolean; perCityLimit?: number },
): Promise<BrowserCityResult> {
  const discoveries = await scrapeMaps(city, {
    confirm: options.confirm,
    maxResults: Math.min(options.perCityLimit ?? 10, 20),
  });
  const unresolved: MapsDiscovery[] = [];
  const validated = discoveries.filter((restaurant) => {
    if (validateRestaurant(restaurant)) return true;
    unresolved.push(restaurant);
    return false;
  });
  const restaurants: BrowserCityResult["restaurants"] = [];
  const websiteResults = new Map<string, BrowserCityResult["restaurants"][number]["enrichment"]>();
  for (const restaurant of dedupeRestaurants(validated)) {
    let enrichment: BrowserCityResult["restaurants"][number]["enrichment"] = { skipped: true };
    if (restaurant.website) {
      const parsed = new URL(restaurant.website);
      parsed.hash = "";
      const key = parsed.href;
      const cached = websiteResults.get(key);
      if (cached) {
        enrichment = cached;
      } else {
        try {
          enrichment = await scrapeWebsite(restaurant.website, { confirm: true });
        } catch {
          enrichment = { error: "website_extraction_failed" };
        }
        websiteResults.set(key, enrichment);
      }
    }
    // Keep website observations separate from canonical identity/address fields.
    restaurants.push({ ...restaurant, enrichment });
  }
  for (const restaurant of restaurants) queueForInsertion(restaurant);
  logEvent(unresolved.length ? "warning" : "info",
    `Browser city scan: ${restaurants.length} validated records queued; ${unresolved.length} unresolved discoveries not queued`);
  return {
    source: "playwright", persisted: false,
    queuedCount: restaurants.length, restaurants, unresolved,
  };
}