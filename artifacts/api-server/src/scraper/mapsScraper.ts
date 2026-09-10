import { runImport, SUPPORTED_CITIES, type ImportedRestaurant } from "../lib/restaurant-import";
import { logEvent } from "../utils/eventLog";

// Keep the canonical Place ID and existing fields for downstream deduplication.
// Optional details remain absent unless the provider actually returned them.
export interface MapsRestaurant extends ImportedRestaurant {
  mapsUrl: string;
  reviewsCount?: number;
  cuisine?: string;
  phone?: string;
}

export interface MapsScanOptions {
  confirm: boolean;
  perCityLimit?: number;
  monthlyBudgetCents?: number;
}

/**
 * Uses the existing official Places importer, including its persistence and
 * spending checks. Returned listings are already saved; do not insert again.
 */
export async function scrapeMapsForCity(
  city: string,
  options: MapsScanOptions = { confirm: false },
): Promise<MapsRestaurant[]> {
  if (options.confirm !== true) throw new Error("City scan confirmation is required.");
  if (typeof city !== "string" || !city.trim()) throw new Error("A city name is required.");
  const canonicalCity = SUPPORTED_CITIES.find(
    (supported) => supported.toLowerCase() === city.trim().toLowerCase(),
  );
  if (!canonicalCity) throw new Error("Unsupported city.");
  const monthlyBudgetCents = options.monthlyBudgetCents ?? 2500;
  if (!Number.isInteger(monthlyBudgetCents) || monthlyBudgetCents < 1 || monthlyBudgetCents > 2500) {
    throw new Error("Monthly import budget must be between 1 and 2500 pence.");
  }
  const perCityLimit = options.perCityLimit ?? 10;
  if (!Number.isInteger(perCityLimit) || perCityLimit < 1 || perCityLimit > 20) {
    throw new Error("City scan limit must be an integer from 1 to 20.");
  }

  logEvent("info", `Maps scan started for: ${canonicalCity}`);
  try {
    const result = await runImport({
      cities: [canonicalCity], perCityLimit, monthlyBudgetCents, confirm: true,
    });
    if (result.apiCalls === 0) {
      logEvent("warning", "Maps scan skipped: monthly budget has no room for this request");
      throw new Error("No scan performed.");
    }
    const restaurants = result.restaurants.map((restaurant) => ({
      ...restaurant,
      mapsUrl: restaurant.googleMapsUrl,
    }));
    logEvent("success", `Maps scan finished for ${canonicalCity} with ${restaurants.length} results`);
    return restaurants;
  } catch {
    logEvent("error", `Maps scan failed for: ${canonicalCity}`);
    throw new Error("Maps scan failed or was blocked by the budget. Check import status before retrying; some listings may already be saved.");
  }
}

// Preserve compatibility for callers using the original adapter name.
export const scrapeMapsResults = scrapeMapsForCity;