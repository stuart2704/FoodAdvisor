import type { ExternalCandidate } from "./candidateTypes";
import { logger } from "../lib/logger";
import { resolveIdentity } from "./identityResolution";
import { confidenceScore } from "./confidenceScore";
import { enrichCandidate } from "./enrichment";
import { normalizeAddress } from "./addressNormalize";
import { isSuppressedRestaurant } from "./suppressionList";
import { freeVerify } from "./freeVerification";
import { outreachPriority } from "./outreachPriority";
import { outreachThrottle } from "../outreach/throttle";
import { restaurantRank } from "./restaurantRank";
import { paidTierRecommendation } from "./paidTier";

/**
 * Screen UNVERIFIED candidates. Scores alone must never publish a listing
 * or opt it into outreach; source rights and verified location are separate gates.
 */
export async function promoteCandidates(
  candidates: ExternalCandidate[],
  now: Date
): Promise<void> {
  if (candidates.length === 0) {
    logger.info(
      { at: now.toISOString() },
      "No candidates to promote (0)"
    );
    return;
  }

  const available = candidates.filter((c) => {
    const normalizedAddress = normalizeAddress(c.rawAddress);
    return !isSuppressedRestaurant(c.rawName, normalizedAddress);
  });
  const resolved = resolveIdentity(available);
  const screened = resolved.filter((candidate) => confidenceScore(candidate) >= 40);
  const previews = screened.map((c) => {
    const enrichment = enrichCandidate(c);
    const verifiedShape = freeVerify(c);
    const restaurant = {
      ...enrichment,
      website: verifiedShape.website,
      phone: verifiedShape.phone,
    };
    const priority = outreachPriority(restaurant);
    const rank = restaurantRank(restaurant);
    const tier = paidTierRecommendation({ rank });
    const delayMinutes = outreachThrottle(priority);
    return { enrichment, priority, rank, tier, delayMinutes };
  });

  logger.info(
    {
      at: now.toISOString(),
      count: candidates.length,
      suppressed: candidates.length - available.length,
      resolved: resolved.length,
      meetsCompletenessThreshold: screened.length,
      belowThreshold: resolved.length - screened.length,
      cuisineTagged: previews.filter((value) => value.enrichment.cuisine !== null).length,
      highestOutreachPriorityPreview: Math.max(0, ...previews.map((value) => value.priority)),
      highestRestaurantRankPreview: Math.max(0, ...previews.map((value) => value.rank)),
      tierRecommendationPreview: {
        basic: previews.filter((value) => value.tier === "basic").length,
        plus: previews.filter((value) => value.tier === "plus").length,
        premium: previews.filter((value) => value.tier === "premium").length,
        enterprise: previews.filter((value) => value.tier === "enterprise").length,
      },
      shortestSuggestedDelayMinutes: previews.length
        ? Math.min(...previews.map((value) => value.delayMinutes))
        : null,
    },
    "External candidates screened; publication and outreach remain disabled"
  );
}