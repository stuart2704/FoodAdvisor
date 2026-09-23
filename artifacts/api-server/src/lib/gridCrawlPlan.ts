import { createHash } from "node:crypto";
import { getRegionForCity } from "../services/regionMap";
import { isValidLatitude, isValidLongitude } from "./geo";
import { regionSchedule } from "./regionSchedule";

export type GridPoint = {
  region: string;
  city: string;
  country: string;
  globalRegion: string;
  latitude: number;
  longitude: number;
};

export const DAILY_GRID_LIMIT = 50;
export const DELAY_BETWEEN_REQUESTS_MS = 15_000;

export function parseGrid(raw: unknown): GridPoint[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Grid must be an object of regions containing cities and coordinate arrays.");
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
      throw new Error(`Region ${regionKey} must contain city arrays.`);
    }
    for (const [cityKey, coordinates] of Object.entries(cities)) {
      const cityName = cityKey.replace(/_/g, " ").trim().replace(/^new york city$/i, "New York");
      const city = cityName.replace(/\b\w/g, (letter) => letter.toUpperCase());
      const location = getRegionForCity(city);
      if (!location) throw new Error(`Unknown city ${cityKey}; add a verified mapping before crawling.`);
      if (regionKey.replace(/_/g, "").toLowerCase() !== location.globalRegion.replace(/\s/g, "").toLowerCase()) {
        throw new Error(`City ${city} does not belong to region ${regionKey}.`);
      }
      if (!Array.isArray(coordinates)) throw new Error(`Coordinates for ${city} must be an array.`);
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