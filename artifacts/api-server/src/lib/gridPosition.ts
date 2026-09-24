import { gridCityCoordinates, parseGrid, type GridPoint } from "./gridCrawlPlan";
import { regionSchedule } from "./regionSchedule";
import type { CrawlerProgressPosition } from "./crawlerProgress";

/**
 * Resolve a saved position for inspection only. The DB row has no grid hash
 * or UTC-day reservation state, so it must not drive billable requests yet.
 */
export function resolveGridPosition(
  grid: unknown,
  position: CrawlerProgressPosition,
): { region: string; city: string; point: GridPoint; flatIndex: number } {
  for (const [name, value] of Object.entries(position)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a nonnegative safe integer.`);
    }
  }
  const points = parseGrid(grid);
  const region = regionSchedule[position.regionIndex];
  if (!region) throw new Error("Saved region index is outside the schedule.");
  const source = grid as Record<string, Record<string, unknown>>;
  const cities = source[region];
  if (!cities || !Object.keys(cities).length) {
    throw new Error(`No coordinate points are supplied for ${region}.`);
  }
  const city = Object.keys(cities)[position.cityIndex];
  if (!city) throw new Error(`Saved city index is outside ${region}.`);
  if (!gridCityCoordinates(cities[city], city)[position.pointIndex]) {
    throw new Error(`Saved point index is outside ${region}/${city}.`);
  }

  let flatIndex = 0;
  for (const scheduledRegion of regionSchedule) {
    for (const [cityName, entry] of Object.entries(source[scheduledRegion] ?? {})) {
      if (scheduledRegion === region && cityName === city) {
        return { region, city, point: points[flatIndex + position.pointIndex], flatIndex: flatIndex + position.pointIndex };
      }
      flatIndex += gridCityCoordinates(entry, cityName).length;
    }
  }
  throw new Error("Saved grid position could not be resolved.");
}

/** Next unprocessed position. A finished grid returns null, never wraps. */
export function nextGridPosition(
  grid: unknown,
  position: CrawlerProgressPosition,
): CrawlerProgressPosition | null {
  resolveGridPosition(grid, position);
  const source = grid as Record<string, Record<string, unknown>>;
  const currentRegion = regionSchedule[position.regionIndex];
  const currentCities = Object.keys(source[currentRegion]);
  const currentPoints = gridCityCoordinates(
    source[currentRegion][currentCities[position.cityIndex]],
    currentCities[position.cityIndex],
  );
  if (position.pointIndex + 1 < currentPoints.length) {
    return { ...position, pointIndex: position.pointIndex + 1 };
  }
  for (let regionIndex = position.regionIndex; regionIndex < regionSchedule.length; regionIndex++) {
    const cities = source[regionSchedule[regionIndex]] ?? {};
    const cityNames = Object.keys(cities);
    const startCity = regionIndex === position.regionIndex ? position.cityIndex + 1 : 0;
    for (let cityIndex = startCity; cityIndex < cityNames.length; cityIndex++) {
      if (gridCityCoordinates(cities[cityNames[cityIndex]], cityNames[cityIndex]).length) {
        return { regionIndex, cityIndex, pointIndex: 0 };
      }
    }
  }
  return null;
}