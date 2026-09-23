export const STALE_DAYS = 60;
export const STALE_RATING_CHANGE = 0.3;
export const STALE_REVIEW_JUMP = 50;
export const STALE_AFTER_MS = STALE_DAYS * 86_400_000;

export const CRITICAL_FIELDS = [
  "address",
  "price_level",
  "cuisines",
  "amenities",
  "phone",
  "website",
] as const;

type CompletenessListing = {
  address?: string | null;
  price_level?: string | null;
  priceLevel?: string | null;
  cuisines?: string[] | null;
  amenities?: string[] | null;
  phone?: string | null;
  website?: string | null;
};

/** Informational only: phone/amenities cannot be filled by Nearby Search. */
export function missingFieldNames(existing: CompletenessListing): (typeof CRITICAL_FIELDS)[number][] {
  return CRITICAL_FIELDS.filter((field) => {
    switch (field) {
      case "address": return !existing.address?.trim();
      case "price_level": return !(existing.priceLevel ?? existing.price_level)?.trim();
      case "cuisines": return !existing.cuisines?.length;
      case "amenities": return !existing.amenities?.length;
      case "phone": return !existing.phone?.trim();
      case "website": return !existing.website?.trim();
    }
  });
}

export function hasMissingFields(existing: CompletenessListing): boolean {
  return missingFieldNames(existing).length > 0;
}

type Existing = {
  updatedAt: Date | null;
  rating: number | null;
  reviewCount: number | null;
  address: string | null;
  cuisines: string[] | null;
  priceLevel: string | null;
  website: string | null;
};

type Incoming = {
  rating?: number;
  reviewCount?: number;
  address?: string;
  cuisines?: string[];
  priceLevel?: string;
  website?: string;
};

/** Only fields the Nearby response can actually improve count as missing. */
export function stalenessReasons(existing: Existing, incoming: Incoming, now = new Date()): string[] {
  const reasons: string[] = [];
  if (!existing.updatedAt || now.getTime() - existing.updatedAt.getTime() > STALE_AFTER_MS) reasons.push("age");
  if (existing.rating !== null && incoming.rating !== undefined &&
      Math.abs(existing.rating - incoming.rating) > STALE_RATING_CHANGE + 1e-9) reasons.push("rating");
  if (existing.reviewCount !== null && incoming.reviewCount !== undefined &&
      incoming.reviewCount - existing.reviewCount > STALE_REVIEW_JUMP) reasons.push("reviews");
  if (!existing.address?.trim() && incoming.address) reasons.push("missing_address");
  if (!existing.cuisines?.length && incoming.cuisines?.length) reasons.push("missing_cuisines");
  if (!existing.priceLevel?.trim() && incoming.priceLevel) reasons.push("missing_price");
  if (!existing.website?.trim() && incoming.website) reasons.push("missing_website");
  return reasons;
}

export function isStale(existing: Existing, incoming: Incoming, now = new Date()): boolean {
  return stalenessReasons(existing, incoming, now).length > 0;
}