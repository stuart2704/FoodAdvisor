export type OutreachTone = "professional" | "friendly" | "premium" | "casual";

export interface ToneSignals {
  brandingQuality?: string | null;
  rating?: number | null;
  cuisine?: string | null;
  website?: string | null;
}

export function analyzeTone(restaurant: ToneSignals): OutreachTone {
  const quality = restaurant.brandingQuality?.trim().toLowerCase();
  const cuisine = restaurant.cuisine?.trim().toLowerCase();
  const rating = typeof restaurant.rating === "number"
    && Number.isFinite(restaurant.rating) && restaurant.rating >= 0 && restaurant.rating <= 5
    ? restaurant.rating : undefined;

  if (quality === "high" || (rating !== undefined && rating >= 4.6)
    || (cuisine && ["fine dining", "steakhouse", "tasting menu"].includes(cuisine))) {
    return "premium";
  }

  let httpsWebsite = false;
  if (restaurant.website) {
    try {
      const url = new URL(restaurant.website);
      httpsWebsite = url.protocol === "https:" && !url.username && !url.password;
    } catch {
      // An invalid URL is not a website-quality signal.
    }
  }
  if (quality === "medium" || (rating !== undefined && rating >= 4.2) || httpsWebsite) {
    return "professional";
  }
  if (cuisine && ["cafe", "coffee", "breakfast", "brunch", "bistro", "family"].includes(cuisine)) {
    return "friendly";
  }
  return "casual";
}