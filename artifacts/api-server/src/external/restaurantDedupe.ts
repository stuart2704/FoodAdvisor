import { normalizeAddress } from "./addressNormalize";

/** Dedupes a proposed batch, not the existing restaurant database. */
export function dedupeRestaurants<T extends { name: string; address?: string | null }>(
  restaurants: T[],
): T[] {
  const seen = new Set<string>();
  return restaurants.filter((restaurant) => {
    const name = restaurant.name.trim().replace(/\s+/g, " ").toLowerCase();
    const address = normalizeAddress(restaurant.address ?? null)?.toLowerCase();
    // A missing address cannot distinguish two branches of the same chain.
    if (!name || !address) return true;
    const key = JSON.stringify([name, address]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}