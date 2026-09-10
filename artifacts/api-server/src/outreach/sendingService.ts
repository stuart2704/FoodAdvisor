import { runDailyOutreach } from "../lib/outreach";
import { logEvent } from "../utils/eventLog";

/**
 * Send initial outreach to one existing restaurant through the shared,
 * capped Gmail pipeline. Recipient and draft come from stored restaurant data.
 * No new scheduler, direct Gmail bypass, or fake success is introduced.
 */
export async function sendEmail1(restaurant: unknown) {
  return sendSequenceEmail(restaurant, 1);
}

/** Due three days after Email 1; no scheduling side effects. */
export async function sendEmail2(restaurant: unknown) {
  return sendSequenceEmail(restaurant, 2);
}

/** Due seven days after Email 1, and at least a day after Email 2. */
export async function sendEmail3(restaurant: unknown) {
  return sendSequenceEmail(restaurant, 3);
}

async function sendSequenceEmail(restaurant: unknown, step: 1 | 2 | 3) {
  if (!restaurant || typeof restaurant !== "object" || Array.isArray(restaurant)) {
    throw new Error("A restaurant with a Google Place ID is required.");
  }
  const input = restaurant as Record<string, unknown>;
  const placeId = input.placeId ?? input.id;
  if (typeof placeId !== "string" || !placeId.trim() || placeId.trim().length > 512) {
    throw new Error("A valid Google Place ID is required.");
  }
  logEvent("info", `Email ${step} requested`);
  try {
    const result = await runDailyOutreach({
      placeId: placeId.trim(),
      ...(step === 1 ? { initialOnly: true } : { followupStep: step }),
    });
    if (result.failed > 0) {
      throw new Error("Initial outreach could not be confirmed.");
    }
    if (result.sent === 0) {
      logEvent("warning", `Email ${step} not sent: eligibility, timing, previous attempt, recipient, or daily-limit check prevented sending`);
      return {
        success: false as const,
        status: "not_sent" as const,
        reason: "Not due or eligible, no valid recipient, previous unconfirmed attempt, or daily limit reached.",
      };
    }
    logEvent("success", `Email ${step} accepted by Gmail and recorded`);
    return {
      success: true as const,
      status: step === 1 ? "sent" as const
        : step === 2 ? "followup_sent" as const : "final_followup_sent" as const,
      provider: "gmail" as const,
      restaurantId: placeId.trim(),
      timestamp: new Date().toISOString(),
    };
  } catch {
    logEvent("error", `Email ${step} failed or could not be confirmed; review status before retrying`);
    throw new Error("Outreach failed or could not be confirmed; check sending configuration and status before retrying.");
  }
}