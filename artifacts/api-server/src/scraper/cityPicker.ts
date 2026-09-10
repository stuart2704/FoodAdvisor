import { logEvent } from "../dashboard/eventsFeed";
import { SUPPORTED_CITIES } from "../lib/restaurant-import";

// Use the importer's canonical list; adding global destinations here alone
// would produce selections that the current UK importer rejects.
const ALL_CITIES = [...SUPPORTED_CITIES];

// Process-local only: not durable across restarts or shared between instances.
let rotationIndex = 0;

/**
 * Select cities without importing or spending. Returns at most one occurrence
 * of each supported city, even when the requested batch exceeds the list.
 */
export function getNextCities(count: number = 5): string[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("City count must be a non-negative safe integer.");
  }
  const batchSize = Math.min(count, ALL_CITIES.length);
  const cities: string[] = [];
  for (let i = 0; i < batchSize; i++) {
    cities.push(ALL_CITIES[(rotationIndex + i) % ALL_CITIES.length]);
  }
  if (ALL_CITIES.length > 0) {
    rotationIndex = (rotationIndex + batchSize) % ALL_CITIES.length;
  }
  logEvent(`City picker selected ${cities.length} supported cities`);
  return cities;
}

export function resetCityRotation(): void {
  rotationIndex = 0;
  logEvent("City rotation reset");
}

export function getAllCities(): string[] {
  return [...ALL_CITIES];
}

// Same rotation state and validation; selecting cities does not start scans.
export const pickCitiesForToday = getNextCities;