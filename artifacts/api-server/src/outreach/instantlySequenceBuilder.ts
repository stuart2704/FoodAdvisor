import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
import {
  normaliseInstantlyEmail,
  validInstantlyProviderId,
} from "../services/instantly/instantlyContracts.ts";

const INSTANTLY_CONNECTOR = "instantly";
const CREATION_FLAG = "INSTANTLY_CAMPAIGN_CREATION_ENABLED";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_SUBJECT_LENGTH = 500;
const MAX_BODY_LENGTH = 20_000;

/**
 * Instantly replaces this provider variable with its unsubscribe URL when a
 * lead is sent. This is deliberately kept in the draft instead of inventing
 * an application URL that cannot contain a restaurant-specific token.
 */
export const UNSUBSCRIBE_PLACEHOLDER = "{{unsubscribe}}";
const UNSUBSCRIBE_FOOTER = `Unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}`;

export interface SequenceStep {
  subject: string;
  body: string;
  /** Delay before the next email, as defined by the Instantly v2 API. */
  delay: number;
  delayUnit: "days";
}

export interface CreateInstantlySequenceOptions {
  mailboxEmail?: string;
  steps?: readonly SequenceStep[];
}

interface CampaignRecord {
  id: string;
  status: number;
  body: Record<string, unknown>;
}

class SequenceBuilderError extends Error {}

function fail(message: string): never {
  throw new SequenceBuilderError(message);
}

function timeoutMilliseconds(): number {
  const configured = Number(process.env.INSTANTLY_SEQUENCE_BUILDER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(Math.floor(configured), 60_000)
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function providerId(value: unknown, label: string): string {
  if (!validInstantlyProviderId(value)) {
    fail(`Instantly ${label} acknowledgement was invalid.`);
  }
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`Instantly ${label} response was invalid.`);
  }
  return value as Record<string, unknown>;
}

function validName(name: string): string {
  if (typeof name !== "string" || !name.trim() || name.length > 500) {
    fail("Instantly sequence name is invalid.");
  }
  return name.trim();
}

function validStepNumber(stepNumber: number): void {
  if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > 3) {
    fail("Instantly sequence step number is invalid.");
  }
}

function validCopy(subject: string, body: string): void {
  if (
    typeof subject !== "string"
    || !subject.trim()
    || subject.length > MAX_SUBJECT_LENGTH
    || typeof body !== "string"
    || !body.trim()
    || body.length > MAX_BODY_LENGTH
  ) {
    fail("Instantly sequence copy is invalid.");
  }
}

function mailboxEmail(value: string): string {
  if (typeof value !== "string") fail("Instantly mailbox email is invalid.");
  const email = normaliseInstantlyEmail(value);
  if (!email) fail("Instantly mailbox email is invalid.");
  return email;
}

function sequenceId(value: string): string {
  if (typeof value !== "string" || !validInstantlyProviderId(value)) {
    fail("Instantly campaign identifier is invalid.");
  }
  return value;
}

async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new SequenceBuilderError("Instantly request timed out."));
    }, timeoutMilliseconds());
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Connector responses and provider bodies are intentionally not included in
 * errors. Provider responses can contain account, contact, or message data.
 */
async function instantlyJson(
  path: string,
  options?: ProxyOptions,
): Promise<unknown> {
  try {
    const response = await withTimeout(
      new ReplitConnectors().proxy(INSTANTLY_CONNECTOR, path, options),
    );
    if (!response.ok) {
      fail("Instantly request was not accepted.");
    }
    try {
      return await response.json();
    } catch {
      fail("Instantly returned an invalid response.");
    }
  } catch (error) {
    if (error instanceof SequenceBuilderError) throw error;
    throw new SequenceBuilderError("Instantly request failed.");
  }
}

function jsonOptions(method: "PATCH" | "POST", body: Record<string, unknown>): ProxyOptions {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body,
  };
}

function assertCreationEnabled(): void {
  if (process.env[CREATION_FLAG] !== "true") {
    fail("Instantly sequence creation is disabled.");
  }
}

function campaignDraftSchedule(): Record<string, unknown> {
  return {
    // A draft has no delivery dates. The schedule is still required by the
    // v2 create schema and is inert until an owner explicitly activates it.
    start_date: null,
    end_date: null,
    schedules: [{
      name: "The Food Advisor template schedule",
      timing: { from: "00:00", to: "23:59" },
      days: {
        "0": true,
        "1": true,
        "2": true,
        "3": true,
        "4": true,
        "5": true,
        "6": true,
      },
      timezone: "Etc/UTC",
    }],
  };
}

function stepPayload(step: SequenceStep): Record<string, unknown> {
  if (!step || typeof step !== "object") {
    fail("Instantly sequence step is invalid.");
  }
  validCopy(step.subject, step.body);
  if (!Number.isInteger(step.delay) || step.delay < 0 || step.delay > 365) {
    fail("Instantly sequence timing is invalid.");
  }
  if (step.delayUnit !== "days") {
    fail("Instantly sequence timing unit is invalid.");
  }
  return {
    type: "email",
    delay: step.delay,
    delay_unit: step.delayUnit,
    variants: [{
      subject: step.subject,
      body: step.body,
      v_disabled: false,
    }],
  };
}

function fullTemplateSteps(): readonly SequenceStep[] {
  return [
    {
      subject: "Quick question about your restaurant",
      body: [
        "Hi {{restaurant_name}},",
        "",
        "I run The Food Advisor — a curated restaurant directory with a companion mobile app launching soon.",
        "",
        "We’re adding selected restaurants, and yours stood out immediately.",
        "",
        "Your free listing would include your menu and photos inside the app, so diners can discover you more easily.",
        "",
        "Would you like me to send over the details?",
        "",
        "— Stuart",
        "",
        UNSUBSCRIBE_FOOTER,
      ].join("\r\n"),
      // Instantly's delay is before the NEXT step. The first step therefore
      // carries the three-day gap to Email 2.
      delay: 3,
      delayUnit: "days",
    },
    {
      subject: "Your restaurant in our app",
      body: [
        "Hi {{restaurant_name}},",
        "",
        "Just following up — your free listing includes:",
        "• Your menu displayed inside the app",
        "• Photos, opening hours, and location",
        "• Direct links for bookings or delivery",
        "",
        "The app is designed to help diners find great restaurants quickly, and yours fits perfectly.",
        "",
        "Want me to send the setup link?",
        "",
        "— Stuart",
        "",
        UNSUBSCRIBE_FOOTER,
      ].join("\r\n"),
      // Four more days after Email 2 puts Email 3 on day 7.
      delay: 4,
      delayUnit: "days",
    },
    {
      subject: "Final follow‑up",
      body: [
        "Hi {{restaurant_name}},",
        "",
        "This is my last message — happy to send details if you're interested.",
        "",
        "Thanks!",
        "",
        UNSUBSCRIBE_FOOTER,
      ].join("\r\n"),
      // The final step has no next email; keep its delay inert.
      delay: 0,
      delayUnit: "days",
    },
  ];
}

function campaignPayload(
  name: string,
  steps: readonly SequenceStep[],
  email?: string,
): Record<string, unknown> {
  if (!Array.isArray(steps) || steps.length !== 3) {
    fail("Instantly sequence must contain exactly three email steps.");
  }
  const payload: Record<string, unknown> = {
    name: validName(name),
    campaign_schedule: campaignDraftSchedule(),
    sequences: [{
      // Instantly v2 applies each delay before the NEXT step: 3, 4, 0
      // therefore delivers on campaign days 0, 3, and 7.
      steps: steps.map(stepPayload),
    }],
    stop_on_reply: true,
    stop_on_auto_reply: true,
    link_tracking: false,
    open_tracking: false,
    insert_unsubscribe_header: true,
  };
  if (email) payload.email_list = [email];
  return payload;
}

function validateCampaignAcknowledgement(value: unknown): string {
  const response = record(value, "campaign");
  return providerId(response.id, "campaign");
}

async function getCampaign(campaignId: string): Promise<CampaignRecord> {
  const id = sequenceId(campaignId);
  const response = record(
    await instantlyJson(`/v2/campaigns/${encodeURIComponent(id)}`),
    "campaign",
  );
  const returnedId = providerId(response.id, "campaign");
  if (returnedId !== id) {
    fail("Instantly campaign acknowledgement did not match the requested campaign.");
  }
  if (typeof response.status !== "number" || !Number.isInteger(response.status)) {
    fail("Instantly campaign status was invalid.");
  }
  return { id: returnedId, status: response.status, body: response };
}

function assertInactiveDraft(campaign: CampaignRecord): void {
  if (campaign.status !== 0) {
    fail("Instantly campaign is not an inactive draft.");
  }
}

async function validateManagedMailbox(email: string): Promise<string> {
  const normalisedEmail = mailboxEmail(email);
  const response = record(
    await instantlyJson(`/v2/accounts/${encodeURIComponent(normalisedEmail)}`),
    "mailbox",
  );
  const managedEmail = typeof response.email === "string"
    ? normaliseInstantlyEmail(response.email)
    : null;
  if (!managedEmail || managedEmail !== normalisedEmail) {
    fail("Instantly mailbox does not match a managed account.");
  }
  return normalisedEmail;
}

/**
 * Create an inactive v2 campaign draft. Passing options is used by
 * buildFullOutreachSequence so all three steps and the mailbox are committed
 * by one provider request rather than a partial create/add/attach sequence.
 */
export async function createInstantlySequence(
  name: string,
  options: CreateInstantlySequenceOptions = {},
): Promise<string> {
  assertCreationEnabled();
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    fail("Instantly sequence options are invalid.");
  }
  const email = options.mailboxEmail
    ? mailboxEmail(options.mailboxEmail)
    : undefined;
  const steps = options.steps ?? [];
  const payload = options.steps
    ? campaignPayload(name, steps, email)
    : {
      name: validName(name),
      campaign_schedule: campaignDraftSchedule(),
    };
  const response = await instantlyJson(
    "/v2/campaigns",
    jsonOptions("POST", payload),
  );
  return validateCampaignAcknowledgement(response);
}

/**
 * Add or replace one step on an already-created draft. This compatibility
 * helper deliberately reads and checks status before PATCHing; active or
 * paused campaigns are never edited.
 */
export async function addSequenceStep(
  campaignId: string,
  stepNumber: number,
  subject: string,
  body: string,
): Promise<true> {
  assertCreationEnabled();
  validStepNumber(stepNumber);
  validCopy(subject, body);
  const campaign = await getCampaign(campaignId);
  assertInactiveDraft(campaign);

  const sequences = campaign.body.sequences;
  if (!Array.isArray(sequences) || !sequences.length) {
    fail("Instantly campaign sequence was invalid.");
  }
  const existing = record(sequences[0], "campaign sequence");
  const existingSteps = existing.steps;
  if (!Array.isArray(existingSteps) || stepNumber > existingSteps.length + 1) {
    fail("Instantly sequence step order is invalid.");
  }
  const nextSteps = existingSteps.slice();
  nextSteps[stepNumber - 1] = stepPayload({
    subject,
    body,
    // The provider applies delay before the next email, so Email 1 carries
    // the 3-day gap, Email 2 carries the 4-day gap, and Email 3 is terminal.
    delay: stepNumber === 1 ? 3 : stepNumber === 2 ? 4 : 0,
    delayUnit: "days",
  });
  const updated = await instantlyJson(
    `/v2/campaigns/${encodeURIComponent(campaign.id)}`,
    jsonOptions("PATCH", { sequences: [{ steps: nextSteps }] }),
  );
  const updatedId = validateCampaignAcknowledgement(updated);
  if (updatedId !== campaign.id) {
    fail("Instantly campaign acknowledgement did not match the requested campaign.");
  }
  return true;
}

/**
 * Attach a sending email address to an inactive draft. Instantly v2 uses the
 * account email in `email_list`; opaque account IDs are intentionally not
 * accepted.
 */
export async function attachMailbox(
  campaignId: string,
  mailboxId: string,
): Promise<true> {
  assertCreationEnabled();
  const email = await validateManagedMailbox(mailboxId);
  const campaign = await getCampaign(campaignId);
  assertInactiveDraft(campaign);
  const updated = await instantlyJson(
    `/v2/campaigns/${encodeURIComponent(campaign.id)}`,
    jsonOptions("PATCH", { email_list: [email] }),
  );
  const updatedId = validateCampaignAcknowledgement(updated);
  if (updatedId !== campaign.id) {
    fail("Instantly campaign acknowledgement did not match the requested campaign.");
  }
  return true;
}

/**
 * Build the reviewable three-email draft in one POST. This function never
 * creates leads, activates a campaign, or sends mail. Runtime delivery
 * remains the existing one-lead, one-step capped pipeline.
 */
export async function buildFullOutreachSequence(mailboxId: string): Promise<string> {
  assertCreationEnabled();
  const email = await validateManagedMailbox(mailboxId);
  return createInstantlySequence("Food Advisor Outreach", {
    mailboxEmail: email,
    steps: fullTemplateSteps(),
  });
}