import type { ExternalAdapter, ExternalCandidate } from "./candidateTypes";
import { globalCities } from "./cityList";
import { buildBoundingBoxQuery } from "./osmBoundingBox";
import { regionForCountry } from "./regions";

type OsmElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, unknown>;
};

const HALF_BOX_DEGREES = 0.05;
const REQUEST_PAUSE_MS = 1_500;

type City = (typeof globalCities)[number];

async function fetchCities(now: Date, cities: readonly City[]): Promise<ExternalCandidate[]> {
    const candidates = new Map<string, ExternalCandidate>();
    for (const [index, city] of cities.entries()) {
      const region = regionForCountry(city.country);
      if (index > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, REQUEST_PAUSE_MS));
      }
      const query = buildBoundingBoxQuery(
        city.lat - HALF_BOX_DEGREES,
        city.lon - HALF_BOX_DEGREES,
        city.lat + HALF_BOX_DEGREES,
        city.lon + HALF_BOX_DEGREES,
      );
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "TheFoodAdvisor/1.0",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(35_000),
      });
      if (!response.ok) {
        throw new Error(`OSM Overpass request for ${city.name} failed with status ${response.status}`);
      }

      const data: unknown = await response.json();
      if (
        !data ||
        typeof data !== "object" ||
        !("elements" in data) ||
        !Array.isArray(data.elements)
      ) {
        throw new Error(`OSM Overpass returned an invalid response for ${city.name}`);
      }

      for (const element of data.elements as OsmElement[]) {
        if (
          !Number.isSafeInteger(element?.id) ||
          !["node", "way", "relation"].includes(element.type ?? "") ||
          !element.tags
        ) continue;
        const name = element.tags.name;
        if (typeof name !== "string" || !name.trim()) continue;
        const street = element.tags["addr:street"];
        const houseNumber = element.tags["addr:housenumber"];
        const addressParts = [houseNumber, street].filter(
          (part): part is string => typeof part === "string" && !!part.trim(),
        );
        const phone = element.tags.phone ?? element.tags["contact:phone"];
        const website = element.tags.website ?? element.tags["contact:website"];
        const lat = element.lat ?? element.center?.lat;
        const lon = element.lon ?? element.center?.lon;
        const sourceId = `osm:${element.type}:${element.id}`;
        const tags: Record<string, string> = {};
        for (const key of [
          "cuisine", "cuisine:primary", "food", "opening_hours",
          "takeaway", "delivery", "wheelchair", "outdoor_seating",
          "menu", "category", "image",
        ]) {
          if (typeof element.tags[key] === "string") tags[key] = element.tags[key];
        }

        candidates.set(sourceId, {
          sourceId,
          sourceName: "OSM",
          rawName: name.trim(),
          rawAddress: addressParts.length ? addressParts.join(" ") : null,
          rawCoords:
            typeof lat === "number" &&
            typeof lon === "number" &&
            Number.isFinite(lat) &&
            Number.isFinite(lon) &&
            Math.abs(lat) <= 90 &&
            Math.abs(lon) <= 180
              ? { lat, lon }
              : null,
          rawPhone: typeof phone === "string" ? phone : null,
          rawWebsite: typeof website === "string" ? website : null,
          tags,
          sourceFlags: ["open-data", "osm", ...(region ? [`region:${region}`] : [])],
          importedAt: now.toISOString(),
        });
      }
    }
    return [...candidates.values()];
}

export function fetchOsmCandidatesForCity(city: City, now: Date): Promise<ExternalCandidate[]> {
  return fetchCities(now, [city]);
}

export const osmAdapter: ExternalAdapter = {
  fetch: ({ now }) => fetchCities(now, globalCities),
};