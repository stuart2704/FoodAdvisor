/**
 * Reserved direct-reply entry point. Live sending is deliberately unavailable.
 *
 * Do not route this through sendInstantlyEmail: that function belongs to the
 * capped outreach campaign pipeline, not arbitrary replies. Enabling this
 * requires a verified v2 reply contract, stored message/recipient ownership,
 * suppression and daily-cap enforcement, and idempotent delivery tracking.
 * Existing outreach environment flags must never enable this separate path.
 */
export class DirectEmailDisabledError extends Error {
  readonly code = "DIRECT_EMAIL_DISABLED";

  constructor() {
    super("Direct reply sending is disabled. Prepare a reply draft for review instead. No email was queued or sent.");
    this.name = "DirectEmailDisabledError";
  }
}

/**
 * restaurantId must be a canonical Google Place ID, not a numeric row ID.
 * Accepting these parameters does not authorize a recipient or send anything.
 * Intentionally performs no database, provider, or logging operations.
 */
export async function sendEmail(
  restaurantId: string,
  to: string,
  subject: string,
  body: string,
): Promise<never> {
  if (typeof restaurantId !== "string" || !restaurantId.trim() || restaurantId.length > 512) {
    throw new Error("A valid Google Place ID is required.");
  }
  if (typeof to !== "string" || to.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) {
    throw new Error("A valid recipient email address is required.");
  }
  if (typeof subject !== "string" || !subject.trim() || subject.length > 998 || /[\r\n]/.test(subject)) {
    throw new Error("A non-empty, single-line email subject is required.");
  }
  if (typeof body !== "string" || !body.trim() || body.length > 100_000) {
    throw new Error("A non-empty email body of at most 100,000 characters is required.");
  }
  if (/\{\{|\}\}/.test(subject + body)) {
    throw new Error("Email template placeholders must be resolved before sending.");
  }
  throw new DirectEmailDisabledError();
}