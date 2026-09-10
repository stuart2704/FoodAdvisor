import { runDailyOutreach } from "../lib/outreach";
import { logEvent } from "../utils/eventLog";

/**
 * Send initial outreach to one existing restaurant through the shared,
 * capped Gmail pipeline. Recipient and draft come from stored restaurant data.
 * No new scheduler, direct Gmail bypass, or fake success is introduced.
 */
export async function sendEmail1(restaurant: unknown) {
  if (!restaurant || typeof restaurant !== "object" || Array.isArray(restaurant)) {
    throw new Error("A restaurant with a Google Place ID is required.");
  }
  const input = restaurant as Record<string, unknown>;
  const placeId = input.placeId ?? input.id;
  if (typeof placeId !== "string" || !placeId.trim() || placeId.trim().length > 512) {
    throw new Error("A valid Google Place ID is required.");
  }
  logEvent("info", "Initial outreach requested");
  try {
    const result = await runDailyOutreach({ placeId: placeId.trim(), initialOnly: true });
    if (result.failed > 0) {
      throw new Error("Initial outreach could not be confirmed.");
    }
    if (result.sent === 0) {
      logEvent("warning", "Initial outreach not sent: eligibility, previous attempt, recipient, or daily-limit check prevented sending");
      return {
        success: false as const,
        status: "not_sent" as const,
        reason: "No eligible unsent restaurant, no valid recipient, previous sending attempt, or daily limit reached.",
      };
    }
    logEvent("success", "Initial outreach accepted by Gmail and recorded");
    return {
      success: true as const,
      status: "sent" as const,
      provider: "gmail" as const,
      restaurantId: placeId.trim(),
      timestamp: new Date().toISOString(),
    };
  } catch {
    logEvent("error", "Initial outreach failed or could not be confirmed; review status before retrying");
    throw new Error("Initial outreach failed or could not be confirmed; check sending configuration and status before retrying.");
  }
}