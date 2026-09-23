export type NearbyPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  googleMapsUri?: string;
  types?: string[];
};

/**
 * Fields supported by a Places Nearby response. Omitted fields are never
 * cleared on an existing restaurant. Preserve owner data, classification
 * guesses, location/region assignments and the existing Maps URL.
 */
export function verifiedExistingFields(place: NearbyPlace) {
  const fields: {
    name?: string;
    address?: string;
    rating?: number;
    reviewCount?: number;
    priceLevel?: string;
    website?: string;
    cuisineTags?: string[];
    cuisines?: string[];
  } = {};
  const name = place.displayName?.text?.trim();
  const address = place.formattedAddress?.trim();
  if (name) fields.name = name;
  if (address) fields.address = address;
  if (typeof place.rating === "number" && Number.isFinite(place.rating) && place.rating >= 0 && place.rating <= 5) {
    fields.rating = place.rating;
  }
  if (Number.isSafeInteger(place.userRatingCount) && place.userRatingCount! >= 0) {
    fields.reviewCount = place.userRatingCount;
  }
  if (typeof place.priceLevel === "string" && place.priceLevel.trim() &&
      place.priceLevel !== "PRICE_LEVEL_UNSPECIFIED") {
    fields.priceLevel = place.priceLevel;
  }
  if (typeof place.websiteUri === "string" && /^https?:\/\//i.test(place.websiteUri)) {
    fields.website = place.websiteUri;
  }
  const types = place.types?.filter((type) => typeof type === "string" && type.length > 0) ?? [];
  if (types.length) {
    const cuisines = types
      .filter((type) => type.endsWith("_restaurant") && type !== "restaurant")
      .map((type) => type.replace(/_restaurant$/, "").replace(/_/g, " "));
    if (cuisines.length) {
      fields.cuisineTags = cuisines;
      fields.cuisines = cuisines;
    }
  }
  return fields;
}