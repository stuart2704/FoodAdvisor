/**
 * Suggested delay in minutes for an already-authorized outreach workflow.
 * This does not establish eligibility or schedule a send.
 */
export function outreachThrottle(priority: number): number {
  if (!Number.isFinite(priority)) throw new Error("Outreach priority must be finite.");
  if (priority >= 80) return 1;
  if (priority >= 60) return 5;
  if (priority >= 40) return 30;
  return 120;
}