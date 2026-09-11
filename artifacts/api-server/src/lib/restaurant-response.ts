import type { RestaurantRecord } from "@workspace/db";

export function toRestaurantResponse(
  row: RestaurantRecord,
  distanceMiles?: number,
) {
  return {
    id: row.placeId,
    name: row.name,
    address: row.address,
    city: row.city,
    location:
      row.latitude === null || row.longitude === null
        ? null
        : { latitude: row.latitude, longitude: row.longitude },
    rating: row.rating,
    website: row.website,
    googleMapsUrl: row.googleMapsUrl,
    types: row.types,
    outreachStatus: row.outreachStatus,
    claimed: row.claimStatus !== null,
    ...(distanceMiles === undefined ? {} : { distanceMiles }),
  };
}