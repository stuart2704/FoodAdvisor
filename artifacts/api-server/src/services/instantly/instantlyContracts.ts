export const INSTANTLY_PROVIDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normaliseInstantlyEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320
    ? email
    : null;
}

export function validInstantlyProviderId(value: unknown): value is string {
  return typeof value === "string" && INSTANTLY_PROVIDER_ID.test(value);
}

export function instantlyActivationEnabled(
  environment: { INSTANTLY_CAMPAIGN_ACTIVATION_ENABLED?: string },
): boolean {
  return environment.INSTANTLY_CAMPAIGN_ACTIVATION_ENABLED === "true";
}

export const CANCELLATION_BATCH_LIMIT = 50;

export function assertCancellationBatchComplete(
  processed: number,
  hasLeftover: boolean,
): void {
  if (processed >= CANCELLATION_BATCH_LIMIT && hasLeftover) {
    throw new Error("Instantly campaign cancellation backlog exceeds the safe batch limit.");
  }
}

export function receivedEmailsPath(eaccount: string, startingAfter?: string): string {
  const query = new URLSearchParams({
    email_type: "received",
    eaccount,
    limit: "100",
  });
  if (startingAfter) query.set("starting_after", startingAfter);
  return `/v2/emails?${query.toString()}`;
}

export function campaignEmailsPath(
  campaignId: string,
  eaccount: string,
  startingAfter?: string,
): string {
  const query = new URLSearchParams({
    campaign_id: campaignId,
    eaccount,
    email_type: "sent",
    limit: "100",
  });
  if (startingAfter) query.set("starting_after", startingAfter);
  return `/v2/emails?${query.toString()}`;
}

export function matchesInstantlyOwnership(
  mapping: { campaignId: string; recipientEmail: string; eaccount: string },
  reply: {
    campaignId: string;
    eaccount: string | null;
    emailType: string | null;
    from: string | null;
    recipients: string[] | null;
  },
): boolean {
  return mapping.campaignId === reply.campaignId
    && reply.emailType === "received"
    && mapping.eaccount === reply.eaccount
    && mapping.recipientEmail === reply.from
    && reply.recipients?.includes(mapping.eaccount) === true;
}

export function matchesInstantlySentOwnership(
  mapping: { campaignId: string; recipientEmail: string; eaccount: string },
  email: {
    campaignId: string;
    eaccount: string | null;
    emailType: string | null;
    from: string | null;
    recipients: string[] | null;
  },
): boolean {
  return mapping.campaignId === email.campaignId
    && email.emailType === "sent"
    && mapping.eaccount === email.eaccount
    && mapping.eaccount === email.from
    && email.recipients?.includes(mapping.recipientEmail) === true;
}

export function hasCompleteInstantlyDirection(email: {
  id: string | null;
  eaccount: string | null;
  emailType: string | null;
  from: string | null;
  recipients: string[] | null;
}): boolean {
  return Boolean(email.id && email.eaccount && email.emailType && email.from
    && email.recipients && email.recipients.length > 0);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Exact v2 campaign shape: one lead, one immediate email, one UTC date. */
export function singleStepCampaignPayload(
  subject: string,
  text: string,
  utcDate: string,
): Record<string, unknown> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDate)) throw new Error("Invalid UTC campaign date.");
  return {
    campaign_schedule: {
      schedules: [{
        name: "single-day, single-lead delivery",
        timing: { from: "00:00", to: "23:59" },
        days: { "0": true, "1": true, "2": true, "3": true, "4": true, "5": true, "6": true },
        timezone: "Etc/UTC",
      }],
      start_date: utcDate,
      end_date: utcDate,
    },
    sequences: [{
      steps: [{
        type: "email",
        delay: 0,
        delay_unit: "days",
        variants: [{
          subject: subject.slice(0, 500),
          body: escapeHtml(text).replace(/\r?\n/g, "<br>"),
          v_disabled: false,
        }],
      }],
    }],
    daily_limit: 1,
    daily_max_leads: 1,
    stop_on_reply: true,
    stop_on_auto_reply: true,
    link_tracking: false,
    open_tracking: false,
  };
}