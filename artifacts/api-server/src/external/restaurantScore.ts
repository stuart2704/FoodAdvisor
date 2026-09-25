import type { OutreachPriorityInput } from "./outreachPriority";

export type RestaurantScoreInput = OutreachPriorityInput & {
  menuUrl?: string | null;
  photoUrl?: string | null;
};

/** Source-data completeness only, not listing quality or verification. */
export function restaurantScore(restaurant: RestaurantScoreInput): number {
  let score = 0;
  if (restaurant.website) score += 20;
  if (restaurant.phone) score += 20;
  if (restaurant.cuisine) score += 10;
  if (restaurant.openingHours) score += 10;
  if (restaurant.menuUrl) score += 10;
  if (restaurant.photoUrl) score += 10;
  if (restaurant.delivery || restaurant.takeaway) score += 10;
  return score;
}