import { pool } from "@workspace/db";
import type {
  GridPoint,
  GridCityBudgetMetadata,
  GridRegionMetadata,
} from "./gridCrawlPlan";

export type GridCrawlAggregateRow = {
  city: string;
  global_region?: string | null;
  region?: string | null;
  listing_count?: number | string | null;
  restaurant_count?: number | string | null;
  count?: number | string | null;
  popularity?: number | null;
  avg_popularity?: number | null;
  missing_fields_rate?: number | null;
  avg_missing_fields_rate?: number | null;
  stale_rate?: number | null;
  avg_stale_rate?: number | null;
};

export type GridCrawlScores = {
  cities: Record<string, GridCityBudgetMetadata>;
  regions: Record<string, GridRegionMetadata>;
};

const DAY = 24 * 60 * 60 * 1_000;
const staleAge = 60 * DAY;

/** Deliberately locale-independent: database and grid keys use the same form. */
function keyPart(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function globalRegionKey(value: unknown): string {
  return keyPart(value).replace(/[\s-]+/g, "_");
}

function bounded(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function rowCount(row: GridCrawlAggregateRow): number {
  const value = row.restaurant_count ?? row.listing_count ?? row.count ?? 0;
  const count = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function cityKey(point: GridPoint): string {
  return `${globalRegionKey(point.globalRegion)}/${keyPart(point.city)}`;
}

function locationKey(point: GridPoint): string {
  return `${cityKey(point)}/${keyPart(point.region)}`;
}

function emptyScore(): GridCityBudgetMetadata {
  return { popularity: 0, density: 0, missing_fields_rate: 1, stale_rate: 1 };
}

/**
 * Convert read-only restaurant aggregates to budget metadata. Legacy rows without
 * global_region are matched only when their city identifies one grid location.
 */
export function computeGridCrawlScores(
  points: readonly GridPoint[],
  rows: readonly GridCrawlAggregateRow[],
  now = Date.now(),
): GridCrawlScores {
  if (!Array.isArray(points) || points.length === 0) throw new Error("Validated grid points are required.");
  const cityPoints = new Map<string, GridPoint>();
  const cityOnly = new Map<string, Map<string, GridPoint>>();
  for (const point of points) {
    cityPoints.set(cityKey(point), point);
    const city = keyPart(point.city);
    const locations = cityOnly.get(city) ?? new Map<string, GridPoint>();
    locations.set(locationKey(point), point);
    cityOnly.set(city, locations);
  }

  const aggregates = new Map<string, { count: number; popularity: number; missing: number; stale: number }>();
  for (const row of rows) {
    if (!row || !keyPart(row.city)) continue;
    const point = row.global_region
      ? cityPoints.get(`${globalRegionKey(row.global_region)}/${keyPart(row.city)}`)
      : (cityOnly.get(keyPart(row.city))?.size === 1
        ? [...cityOnly.get(keyPart(row.city))!.values()][0]
        : undefined);
    if (!point) continue;
    const key = cityKey(point);
    const count = rowCount(row);
    if (!count) continue;
    const old = aggregates.get(key) ?? { count: 0, popularity: 0, missing: 0, stale: 0 };
    old.count += count;
    old.popularity += bounded(Number(row.popularity ?? row.avg_popularity ?? 0)) * count;
    old.missing += bounded(Number(row.missing_fields_rate ?? row.avg_missing_fields_rate ?? 1)) * count;
    old.stale += bounded(Number(row.stale_rate ?? row.avg_stale_rate ?? 1)) * count;
    aggregates.set(key, old);
  }

  const maxCount = Math.max(0, ...[...aggregates.values()].map((a) => a.count));
  const cities: Record<string, GridCityBudgetMetadata> = {};
  for (const point of cityPoints.values()) {
    const key = `${globalRegionKey(point.globalRegion)}/${point.city}`;
    const aggregate = aggregates.get(cityKey(point));
    cities[key] = aggregate
      ? {
          popularity: bounded(aggregate.popularity / aggregate.count),
          density: maxCount ? bounded(aggregate.count / maxCount) : 0,
          missing_fields_rate: bounded(aggregate.missing / aggregate.count),
          stale_rate: bounded(aggregate.stale / aggregate.count),
        }
      : emptyScore();
  }

  const regions: Record<string, GridRegionMetadata> = {};
  const regionGroups = new Map<string, { counts: number; popularity: number; missing: number; stale: number; max: number }>();
  for (const point of cityPoints.values()) {
    const key = globalRegionKey(point.globalRegion);
    const aggregate = aggregates.get(cityKey(point));
    const group = regionGroups.get(key) ?? { counts: 0, popularity: 0, missing: 0, stale: 0, max: 0 };
    if (aggregate) {
      group.counts += aggregate.count;
      group.popularity += aggregate.popularity;
      group.missing += aggregate.missing;
      group.stale += aggregate.stale;
      group.max = Math.max(group.max, aggregate.count);
    }
    regionGroups.set(key, group);
  }
  for (const [region, group] of regionGroups) {
    regions[region] = group.counts
      ? {
          popularity: bounded(group.popularity / group.counts),
          density: maxCount ? bounded(group.max / maxCount) : 0,
          missing_fields_rate: bounded(group.missing / group.counts),
          stale_rate: bounded(group.stale / group.counts),
        }
      : emptyScore();
  }
  return { cities, regions };
}

/** Load the aggregates used above. This is a parameterized, read-only query. */
export async function loadGridCrawlAggregates(
  points: readonly GridPoint[],
  now = Date.now(),
): Promise<GridCrawlAggregateRow[]> {
  if (!Array.isArray(points) || points.length === 0) throw new Error("Validated grid points are required.");
  const cityNames = [...new Set(points.map((point) => keyPart(point.city)))];
  const cutoff = new Date(now - staleAge);
  const result = await pool.query<GridCrawlAggregateRow>(`
    SELECT city, global_region,
           COUNT(*)::int AS restaurant_count,
           AVG(LEAST(1, GREATEST(0, popularity))) AS popularity,
           AVG(((website IS NULL OR btrim(website) = '')::int +
                (price_level IS NULL OR btrim(price_level) = '')::int +
                (cuisines IS NULL OR cardinality(cuisines) = 0)::int +
                (address IS NULL OR btrim(address) = '')::int) / 4.0) AS missing_fields_rate,
           AVG((updated_at IS NULL OR updated_at < $2)::int) AS stale_rate
      FROM restaurants
     WHERE lower(btrim(city)) = ANY($1::text[])
     GROUP BY city, global_region
  `, [cityNames, cutoff]);
  return result.rows;
}

export const scoreGridCrawl = computeGridCrawlScores;
export const buildGridCrawlScores = computeGridCrawlScores;
export const loadGridCityAggregates = loadGridCrawlAggregates;