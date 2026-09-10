export type FollowupStep = 2 | 3;

export interface FollowupAudit {
  event: string;
  createdAt: Date;
  detail: string | null;
}

/** Both delays are measured from Email 1, not from the previous follow-up. */
export function isFollowupDue(step: FollowupStep, history: FollowupAudit[], now: Date): boolean {
  if (history.some((item) => ["reply_classified", "send_failed"].includes(item.event))) return false;
  const sent = history.filter((item) => item.event === "sent")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const attempts = history.filter((item) => item.event === "send_attempt");
  // Unacknowledged sends are ambiguous. Never retry a sequence automatically.
  if (sent.length !== step - 1 || attempts.length !== sent.length) return false;
  if (step === 3) {
    try {
      if (JSON.parse(sent[1].detail ?? "{}").emailNumber !== 2) return false;
    } catch { return false; }
  }
  const delay = (step === 2 ? 3 : 7) * 24 * 60 * 60 * 1000;
  return Number.isFinite(sent[0].createdAt.getTime())
    && now.getTime() >= sent[0].createdAt.getTime() + delay
    // Do not send two overdue follow-ups together after a long outage.
    && (step === 2 || now.getTime() >= sent[1].createdAt.getTime() + 24 * 60 * 60 * 1000);
}

export function buildFollowupMessage(step: FollowupStep, restaurantName: string) {
  const name = restaurantName.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
  return {
    subject: step === 2 ? `Following up about ${name}` : `Final follow-up about ${name}`,
    body: [
      `Hi ${name} team,`,
      "",
      step === 2
        ? "I’m following up on my earlier email about The Food Advisor."
        : "This is my final follow-up about listing your restaurant on The Food Advisor.",
      "A basic listing is free. Paid verification is currently unavailable, and no subscription is needed for a basic listing.",
      "",
      "If you’d like more information, just reply. If this isn’t of interest, you can unsubscribe using the link below.",
      "",
      "Best wishes,",
      "Stuart",
      "The Food Advisor",
    ].join("\r\n"),
  };
}