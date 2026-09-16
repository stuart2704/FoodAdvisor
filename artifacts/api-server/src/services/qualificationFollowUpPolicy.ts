import type { QualificationResult } from "./leadQualificationService";
import followUpService from "./followUpService";
import restaurantService from "./restaurantService";

interface QualifiedRestaurant {
  placeId?: string;
  id?: string;
  outreachCount: number;
}

export async function applyQualificationFollowUpPolicy(
  restaurant: QualifiedRestaurant,
  qualified: QualificationResult,
) {
  const placeId = restaurant.placeId ?? restaurant.id;
  if (!placeId) throw new Error("A restaurant ID is required.");

  if (qualified.tier === "A" && [1, 2].includes(restaurant.outreachCount)) {
    return followUpService.sendFollowUp(restaurant);
  }
  if (qualified.tier === "B" && restaurant.outreachCount === 1) {
    return followUpService.sendFollowUp(restaurant);
  }
  if (qualified.tier === "D") {
    return {
      success: await restaurantService.markDoNotContact(placeId),
      status: "suppressed" as const,
    };
  }
  return { success: true as const, status: "no_action" as const };
}