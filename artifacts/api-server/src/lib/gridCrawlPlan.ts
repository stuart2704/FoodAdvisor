import { createHash } from "node:crypto";
import { getRegionForCity } from "../services/regionMap";
import { isValidLatitude, isValidLongitude } from "./geo";
import { regionSchedule } from "./regionSchedule";

export type GridCityMetadata = {
  popularity: number;
  density: number;
  missing_fields_rate: number;
};

export type GridRegionMetadata = GridCityMetadata & {
  stale_rate: number;
};

export type GridCityBudgetMetadata = GridRegionMetadata;

export type GridPoint = {
  region: string;
  city: string;
  country: string;
  globalRegion: string;
  latitude: number;
  longitude: number;
  cityMetadata?: GridCityMetadata;
  cityWeight?: number;
};

export const DAILY_GRID_LIMIT = 50;
export const EMERGENCY_RESERVE = Math.ceil(DAILY_GRID_LIMIT * 0.1);
export const DELAY_BETWEEN_REQUESTS_MS = 15_000;
export const ESTIMATED_GRID_REQUEST_COST_CENTS = 50;
export const MONTHLY_PAID_BUDGET_GBP = 30;
export const MONTHLY_PAID_LIMIT = Math.floor(
  MONTHLY_PAID_BUDGET_GBP * 100 / ESTIMATED_GRID_REQUEST_COST_CENTS,
);
export const LOW_PRIORITY_REGION_INTERVAL_DAYS = 7;
export const HIGH_PRIORITY_REGION_INTERVAL_DAYS = 1;

/** Fail closed at £30, including older requests that were recorded below 50p. */
export function paidPlacesBudgetReached(
  spentCents: number,
  usedRequests: number,
  nextCostCents: number,
  configuredBudgetCents: number,
): boolean {
  if (![spentCents, usedRequests, nextCostCents, configuredBudgetCents].every(Number.isSafeInteger) ||
      spentCents < 0 || usedRequests < 0 ||
      nextCostCents < ESTIMATED_GRID_REQUEST_COST_CENTS ||
      nextCostCents > MONTHLY_PAID_BUDGET_GBP * 100 ||
      configuredBudgetCents < ESTIMATED_GRID_REQUEST_COST_CENTS ||
      configuredBudgetCents > MONTHLY_PAID_BUDGET_GBP * 100) {
    throw new Error("Invalid monthly Places usage or budget; stop before another request.");
  }
  return usedRequests >= MONTHLY_PAID_LIMIT ||
    Math.max(spentCents, usedRequests * ESTIMATED_GRID_REQUEST_COST_CENTS) +
      nextCostCents > configuredBudgetCents;
}

export function paidGridBudgetReached(
  spentCents: number,
  usedRequests: number,
  configuredBudgetCents: number,
): boolean {
  return paidPlacesBudgetReached(
    spentCents, usedRequests, ESTIMATED_GRID_REQUEST_COST_CENTS, configuredBudgetCents,
  );
}

export function computeWeight(meta: GridCityMetadata): number {
  if (![meta.popularity, meta.density, meta.missing_fields_rate].every(
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1,
  )) {
    throw new Error("City popularity, density, and missing_fields_rate must each be a number from 0 to 1.");
  }
  return meta.popularity * 0.4 + meta.density * 0.3 + meta.missing_fields_rate * 0.3;
}

/** Informational score only; it does not change crawl order or spending. */
export function computeRegionPriority(meta: GridRegionMetadata): number {
  if (![meta.popularity, meta.density, meta.missing_fields_rate, meta.stale_rate].every(
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1,
  )) {
    throw new Error("Region popularity, density, missing_fields_rate, and stale_rate must each be a number from 0 to 1.");
  }
  return meta.popularity * 0.4 + meta.density * 0.3 +
    meta.missing_fields_rate * 0.2 + meta.stale_rate * 0.1;
}

export const computeRegionWeight = computeRegionPriority;
/** City-budget planning uses the four-factor formula, not the grid's three-factor city weight. */
export const computeCityWeight = computeRegionPriority;

/** Informational shares only; requires the full city list and a configured region allowance. */
export function computeCityBudgets(
  cityNames: readonly string[],
  cityMetadata: Record<string, GridCityBudgetMetadata>,
  regionBudget: number,
): Record<string, number> {
  if (!Number.isSafeInteger(regionBudget) || regionBudget <= 0 || regionBudget > MONTHLY_PAID_LIMIT) {
    throw new Error("Region budget is unconfigured or invalid.");
  }
  if (!cityNames.length || new Set(cityNames).size !== cityNames.length ||
      cityNames.some((city) => !city.trim() || !Object.hasOwn(cityMetadata, city))) {
    throw new Error("A complete, unique city list and metadata for every city are required.");
  }
  const weights = cityNames.map((city) => [city, computeCityWeight(cityMetadata[city])] as const);
  const totalWeight = weights.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) throw new Error("City weights must have a positive total.");
  return Object.fromEntries(
    weights.map(([city, weight]) => [city, Math.floor(weight / totalWeight * regionBudget)]),
  );
}

/** Planning shares of the estimated monthly request ceiling; no reservations. */
export function computeRegionBudgets(
  regionMetadata: Record<string, GridRegionMetadata>,
): Record<string, number> {
  const entries = Object.entries(regionMetadata);
  if (!entries.length) throw new Error("At least one region is required for budget planning.");
  const weights = entries.map(([region, metadata]) => {
    if (!(regionSchedule as readonly string[]).includes(region)) {
      throw new Error(`Unsupported grid region ${region}.`);
    }
    return [region, computeRegionWeight(metadata)] as const;
  });
  const totalWeight = weights.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) throw new Error("Region weights must have a positive total.");
  return Object.fromEntries(
    weights.map(([region, weight]) => [region, Math.floor(weight / totalWeight * MONTHLY_PAID_LIMIT)]),
  );
}

/** For a future authoritative per-region reservation, never the singleton defaults. */
export function regionBudgetReached(regionUsed: number, regionBudget: number): boolean {
  if (!Number.isSafeInteger(regionUsed) || regionUsed < 0 ||
      !Number.isSafeInteger(regionBudget) || regionBudget <= 0 ||
      regionBudget > MONTHLY_PAID_LIMIT) {
    throw new Error("Region budget is unconfigured or invalid; stop before a paid request.");
  }
  return regionUsed >= regionBudget;
}

/** For future atomic city reservations, not a post-request counter increment. */
export function cityBudgetReached(cityUsed: number, cityBudget: number): boolean {
  if (!Number.isSafeInteger(cityUsed) || cityUsed < 0 ||
      !Number.isSafeInteger(cityBudget) || cityBudget <= 0 ||
      cityBudget > MONTHLY_PAID_LIMIT) {
    throw new Error("City budget is unconfigured or invalid; stop before a paid request.");
  }
  return cityUsed >= cityBudget;
}

/** Planning cadence only; does not schedule a paid crawl. */
export function computeRegionInterval(priority: number): number {
  if (typeof priority !== "number" || !Number.isFinite(priority) || priority < 0 || priority > 1) {
    throw new Error("Region priority must be a number from 0 to 1.");
  }
  return Math.round(
    LOW_PRIORITY_REGION_INTERVAL_DAYS -
    priority * (LOW_PRIORITY_REGION_INTERVAL_DAYS - HIGH_PRIORITY_REGION_INTERVAL_DAYS),
  );
}

export function budgetPerPoint(totalPoints: number): number {
  if (!Number.isSafeInteger(totalPoints) || totalPoints <= 0) {
    throw new Error("A positive number of validated grid points is required.");
  }
  return Math.floor(MONTHLY_PAID_LIMIT / totalPoints);
}

/** Informational plan only; not an authorization for a paid request. */
export function adaptiveBudgetForCity(totalPoints: number, meta: GridCityMetadata): number {
  return Math.floor(budgetPerPoint(totalPoints) * (0.5 + computeWeight(meta)));
}

function parseCityEntry(value: unknown, city: string): {
  coordinates: unknown[];
  metadata?: GridCityMetadata;
  weight?: number;
} {
  if (Array.isArray(value)) return { coordinates: value };
  if (!value || typeof value !== "object") {
    throw new Error(`Coordinates for ${city} must be an array or a city object with points.`);
  }
  const entry = value as Record<string, unknown>;
  const allowed = ["points", "popularity", "density", "missing_fields_rate"];
  if (Object.keys(entry).some((key) => !allowed.includes(key)) || !Array.isArray(entry.points)) {
    throw new Error(`City ${city} must have points and only the supported planning scores.`);
  }
  const metadata = {
    popularity: entry.popularity,
    density: entry.density,
    missing_fields_rate: entry.missing_fields_rate,
  } as GridCityMetadata;
  return { coordinates: entry.points, metadata, weight: computeWeight(metadata) };
}

export function gridCityCoordinates(value: unknown, city: string): unknown[] {
  return parseCityEntry(value, city).coordinates;
}

export function parseGrid(raw: unknown): GridPoint[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Grid must be an object of regions containing cities and coordinate points.");
  }
  const points: GridPoint[] = [];
  const regions = raw as Record<string, unknown>;
  for (const regionKey of Object.keys(regions)) {
    if (!(regionSchedule as readonly string[]).includes(regionKey)) {
      throw new Error(`Unsupported grid region ${regionKey}.`);
    }
  }
  for (const regionKey of regionSchedule) {
    if (!(regionKey in regions)) continue;
    const cities = regions[regionKey];
    if (!cities || typeof cities !== "object" || Array.isArray(cities)) {
      throw new Error(`Region ${regionKey} must contain city entries.`);
    }
    for (const [cityKey, entry] of Object.entries(cities)) {
      const cityName = cityKey.replace(/_/g, " ").trim().replace(/^new york city$/i, "New York");
      const city = cityName.replace(/\b\w/g, (letter) => letter.toUpperCase());
      const location = getRegionForCity(city);
      if (!location) throw new Error(`Unknown city ${cityKey}; add a verified mapping before crawling.`);
      if (regionKey.replace(/_/g, "").toLowerCase() !== location.globalRegion.replace(/\s/g, "").toLowerCase()) {
        throw new Error(`City ${city} does not belong to region ${regionKey}.`);
      }
      const { coordinates, metadata, weight } = parseCityEntry(entry, city);
      for (const pair of coordinates) {
        if (!Array.isArray(pair) || pair.length !== 2 ||
            typeof pair[0] !== "number" || typeof pair[1] !== "number" ||
            !isValidLatitude(pair[0]) || !isValidLongitude(pair[1])) {
          throw new Error(`Invalid [latitude, longitude] pair for ${city}.`);
        }
        points.push({
          region: location.region,
          city,
          country: location.country,
          globalRegion: location.globalRegion,
          latitude: pair[0],
          longitude: pair[1],
          ...(metadata ? { cityMetadata: metadata, cityWeight: weight } : {}),
        });
      }
    }
  }
  if (!points.length) throw new Error("The grid has no coordinate points.");
  return points;
}

export function gridHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type GridProgress = {
  version: 1;
  gridHash: string;
  nextIndex: number;
  date: string;
  attemptedToday: number;
};

export function validateProgress(value: unknown, hash: string, length: number): GridProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid progress file.");
  const progress = value as Partial<GridProgress>;
  if (progress.version !== 1 || progress.gridHash !== hash ||
      !Number.isSafeInteger(progress.nextIndex) || progress.nextIndex! < 0 || progress.nextIndex! > length ||
      !/^\d{4}-\d{2}-\d{2}$/.test(progress.date ?? "") ||
      !Number.isSafeInteger(progress.attemptedToday) ||
      progress.attemptedToday! < 0 || progress.attemptedToday! > DAILY_GRID_LIMIT) {
    throw new Error("Progress file does not match this grid or is invalid; do not reset it without reviewing previous calls.");
  }
  return progress as GridProgress;
}