import type { ExternalAdapter, ExternalCandidate } from "./candidateTypes";

type OsmElement = {
  id?: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, unknown>;
};

const query = `
  [out:json][timeout:25];
  node["amenity"="restaurant"]["name"](around:5000,51.4816,-3.1791);
  out body 100;
`;

export const osmAdapter: ExternalAdapter = {
  async fetch({ now }): Promise<ExternalCandidate[]> {
    // Bounded Cardiff sample. Keep public Overpass requests low-volume.
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
      throw new Error(`OSM Overpass request failed with status ${response.status}`);
    }

    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      !("elements" in data) ||
      !Array.isArray(data.elements)
    ) {
      throw new Error("OSM Overpass returned an invalid elements response");
    }

    const candidates: ExternalCandidate[] = [];
    for (const element of data.elements as OsmElement[]) {
      if (!Number.isSafeInteger(element?.id) || !element.tags) continue;
      const name = element.tags.name;
      if (typeof name !== "string" || !name.trim()) continue;
      const street = element.tags["addr:street"];
      const houseNumber = element.tags["addr:housenumber"];
      const addressParts = [houseNumber, street].filter(
        (part): part is string => typeof part === "string" && !!part.trim(),
      );
      const phone = element.tags.phone ?? element.tags["contact:phone"];
      const website = element.tags.website ?? element.tags["contact:website"];

      candidates.push({
        sourceId: `osm:${element.id}`,
        sourceName: "OSM",
        rawName: name.trim(),
        rawAddress: addressParts.length ? addressParts.join(" ") : null,
        rawCoords:
          typeof element.lat === "number" &&
          typeof element.lon === "number" &&
          Number.isFinite(element.lat) &&
          Number.isFinite(element.lon) &&
          Math.abs(element.lat) <= 90 &&
          Math.abs(element.lon) <= 180
            ? { lat: element.lat, lon: element.lon }
            : null,
        rawPhone: typeof phone === "string" ? phone : null,
        rawWebsite: typeof website === "string" ? website : null,
        sourceFlags: ["open-data", "osm"],
        importedAt: now.toISOString(),
      });
    }
    return candidates;
  },
};