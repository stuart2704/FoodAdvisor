import { logEvent } from "../dashboard/eventsFeed";

export type ScalingTier = "standard" | "premium";

// These legacy names describe batch ceilings, not durable daily counters.
// The outreach delivery service separately enforces its database-backed 20-attempt daily cap.
// Import confirmation and the £25 monthly budget remain enforced upstream.
const LIMITS = Object.freeze({
  MAX_CITIES_PER_DAY: 5,
  MAX_RESTAURANTS_PER_CITY: 20,
  MAX_OUTREACH_PER_DAY: 20,
  MAX_REPLIES_PER_DAY: 200,
});

function limitBatch<T>(items: readonly T[], maximum: number, label: string): T[] {
  if (!Array.isArray(items)) throw new Error("Scaling requires an array.");
  const limited = items.slice(0, maximum);
  logEvent(`Scaling: ${limited.length} ${label} selected for this batch; ${items.length - limited.length} not selected`);
  return limited;
}

export function applyScalingLimits(cities: readonly string[], userTier: ScalingTier = "standard"): string[] {
  const limits = getScalingLimits(userTier);
  if (!Array.isArray(cities) || cities.some((city) => typeof city !== "string" || !city.trim())) {
    throw new Error("City names must be non-empty strings.");
  }
  // Duplicated city names must not consume slots or cause repeat paid requests.
  const seen = new Set<string>();
  const unique = cities.map((city) => city.trim()).filter((city) => {
    const key = city.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return limitBatch(unique, limits.MAX_CITIES_PER_DAY, "cities");
}

export function limitRestaurants<T>(restaurants: readonly T[]): T[] {
  return limitBatch(restaurants, LIMITS.MAX_RESTAURANTS_PER_CITY, "restaurants per city");
}

export function limitOutreach<T>(restaurants: readonly T[]): T[] {
  return limitBatch(restaurants, LIMITS.MAX_OUTREACH_PER_DAY, "outreach candidates");
}

export function limitReplies<T>(replies: readonly T[]): T[] {
  return limitBatch(replies, LIMITS.MAX_REPLIES_PER_DAY, "staged replies");
}

export function getScalingLimits(userTier: ScalingTier = "standard") {
  if (userTier !== "standard" && userTier !== "premium") {
    throw new Error("Unsupported scaling tier.");
  }
  return { ...LIMITS, MAX_CITIES_PER_DAY: userTier === "premium" ? 20 : LIMITS.MAX_CITIES_PER_DAY };
}