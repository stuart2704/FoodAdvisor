export function buildBoundingBoxQuery(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number
): string {
  if (
    ![minLat, minLon, maxLat, maxLon].every(Number.isFinite) ||
    minLat < -90 || maxLat > 90 ||
    minLon < -180 || maxLon > 180 ||
    minLat >= maxLat || minLon >= maxLon ||
    maxLat - minLat > 0.2 || maxLon - minLon > 0.2
  ) {
    throw new Error("OSM bounding box must be valid and at most 0.2 degrees per side.");
  }

  return `
    [out:json][timeout:25];
    (
      node["amenity"="restaurant"](${minLat},${minLon},${maxLat},${maxLon});
      way["amenity"="restaurant"](${minLat},${minLon},${maxLat},${maxLon});
      relation["amenity"="restaurant"](${minLat},${minLon},${maxLat},${maxLon});
    );
    out center 100;
  `;
}