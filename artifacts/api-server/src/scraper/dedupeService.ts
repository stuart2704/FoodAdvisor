import { logEvent } from "../dashboard/eventsFeed";

export interface RestaurantIdentity {
  placeId?: string;
  id?: string;
}

/**
 * Deduplicate this batch by case-sensitive Google Place ID, retaining the
 * first occurrence. Branches may share names, websites, and phone numbers.
 * Does not query Neon: the Maps importer already persists its results.
 */
export function dedupeRestaurants<T extends RestaurantIdentity>(restaurants: readonly T[]): T[] {
  if (!Array.isArray(restaurants)) throw new Error("Expected a restaurant array.");
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const restaurant of restaurants) {
    const key = restaurant?.placeId ?? restaurant?.id;
    if (typeof key !== "string" || !key.trim() || key.trim().length > 512) {
      throw new Error("Deduplication requires a valid Google Place ID for every restaurant.");
    }
    const canonicalKey = key.trim();
    if (seen.has(canonicalKey)) continue;
    seen.add(canonicalKey);
    unique.push(restaurant);
  }
  logEvent(`Scraper dedupe: ${unique.length} unique results; ${restaurants.length - unique.length} duplicates removed`);
  return unique;
}