export const DEEP_RATING_SWING = 0.5;
export const DEEP_REVIEW_JUMP = 150;
export const DEEP_MISSING_FIELDS = true;
export const DEEP_POPULAR_THRESHOLD = 500;

type ExistingRestaurant = {
  rating?: number | null;
  reviewCount?: number | null;
  cuisines?: string[] | null;
  amenities?: string[] | null;
};

type IncomingRestaurant = {
  rating?: number | null;
  reviewCount?: number | null;
};

/**
 * Eligibility only. Never use this predicate by itself to start billable
 * requests: missing amenities can keep returning true until a verified
 * source, deduplication, and a provider-side spending limit are in place.
 */
export function needsDeepCrawl(existing: ExistingRestaurant, incoming: IncomingRestaurant): boolean {
  if (typeof existing.rating === "number" && Number.isFinite(existing.rating) &&
      typeof incoming.rating === "number" && Number.isFinite(incoming.rating) &&
      Math.abs(existing.rating - incoming.rating) > DEEP_RATING_SWING + 1e-9) {
    return true;
  }
  if (typeof existing.reviewCount === "number" && Number.isSafeInteger(existing.reviewCount) &&
      typeof incoming.reviewCount === "number" && Number.isSafeInteger(incoming.reviewCount) &&
      incoming.reviewCount - existing.reviewCount > DEEP_REVIEW_JUMP) {
    return true;
  }
  if (typeof existing.reviewCount === "number" && Number.isSafeInteger(existing.reviewCount) &&
      existing.reviewCount > DEEP_POPULAR_THRESHOLD) {
    return true;
  }
  if (DEEP_MISSING_FIELDS && (!existing.cuisines?.length || !existing.amenities?.length)) {
    return true;
  }
  return false;
}