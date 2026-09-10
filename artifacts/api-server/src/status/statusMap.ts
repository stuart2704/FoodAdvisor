/**
 * Workflow labels, not a replacement for persisted outreach/claim statuses.
 * Valid membership does not authorise a transition or establish that an
 * operation (such as sending, scraping, or insertion) actually succeeded.
 */
export const StatusMap = Object.freeze({
  NOT_CONTACTED: "not_contacted",
  CONTACTED: "contacted",
  FOLLOWUP_SENT: "followup_sent",
  FINAL_FOLLOWUP_SENT: "final_followup_sent",
  ENGAGED: "engaged",
  AWAITING_FOLLOWUP: "awaiting_followup",
  CLOSED: "closed",
  SCRAPED: "scraped",
  INSERTED: "inserted",
  ERROR: "error",
  UNKNOWN_REPLY: "unknown_reply",
} as const);

export type RestaurantStatus = typeof StatusMap[keyof typeof StatusMap];

const allowedStatuses = new Set<string>(Object.values(StatusMap));

export function isValidStatus(status: unknown): status is RestaurantStatus {
  return typeof status === "string" && allowedStatuses.has(status);
}