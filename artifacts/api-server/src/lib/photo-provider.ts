export interface PhotoProviderRecord {
  sourceName: string;
  sourceAttribution: string | null;
  published: boolean;
}

export type GooglePhotoAccess =
  | { allowed: true }
  | {
      allowed: false;
      status: 404 | 409;
      body: Record<string, unknown>;
    };

export function isOsmPlaceId(placeId: string): boolean {
  return placeId.toLocaleLowerCase("en-GB").startsWith("osm:");
}

export function checkGooglePhotoAccess(
  placeId: string,
  restaurant: PhotoProviderRecord | null,
): GooglePhotoAccess {
  if (!restaurant || !restaurant.published) {
    return {
      allowed: false,
      status: 404,
      body: { error: "Restaurant not found." },
    };
  }
  if (restaurant.sourceName !== "google") {
    return {
      allowed: false,
      status: 409,
      body: {
        error: "Google Places photos are not available for this source. OSM photo uploads are not supported yet.",
        sourceName: restaurant.sourceName,
        sourceAttribution: restaurant.sourceAttribution,
        uploadSupported: false,
      },
    };
  }
  return { allowed: true };
}