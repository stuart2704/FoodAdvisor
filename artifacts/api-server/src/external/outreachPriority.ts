export type OutreachPriorityInput = {
  website?: string | null;
  phone?: string | null;
  cuisine?: string | null;
  openingHours?: string | null;
  delivery?: boolean | null;
  takeaway?: boolean | null;
  wheelchairAccessible?: boolean | null;
};

/** Ranking preview only. This does not establish consent or outreach eligibility. */
export function outreachPriority(restaurant: OutreachPriorityInput): number {
  let score = 0;
  if (restaurant.website) score += 30;
  if (restaurant.phone) score += 30;
  if (restaurant.cuisine) score += 10;
  if (restaurant.openingHours) score += 10;
  if (restaurant.delivery || restaurant.takeaway) score += 10;
  if (restaurant.wheelchairAccessible) score += 5;
  return score;
}