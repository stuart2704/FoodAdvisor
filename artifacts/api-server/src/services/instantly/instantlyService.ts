import { ReplitConnectors, type ProxyOptions } from "@replit/connectors-sdk";
import {
  db,
  instantlyCampaignCancellationTable,
  instantlyFollowupCampaignsTable,
  instantlyInboxStateTable,
  instantlyOutreachCampaignsTable,
  instantlySentMessagesTable,
  outreachAuditTable,
  pool,
  restaurantsTable,
} from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { processInstantlyIncomingReply } from "../replyClassifier/processIncomingReply";
import {
  assertCancellationBatchComplete,
  CANCELLATION_BATCH_LIMIT,
  campaignEmailsPath,
  hasCompleteInstantlyDirection,
  instantlyActivationEnabled,
  matchesInstantlyOwnership,
  matchesInstantlySentOwnership,
  normaliseInstantlyEmail,
  receivedEmailsPath,
  singleStepCampaignPayload,
  validInstantlyProviderId,
} from "./instantlyContracts";

const MAX_REPLY_BODY_CHARS = 20_000;

export interface InstantlyEmail {
  id: string | null;
  campaignId: string;
  eaccount: string | null;
  emailType: string | null;
  from: string | null;
  recipients: string[] | null;
  body: string;
  sentAt: Date | null;
}

export interface InstantlyCampaignDraft {
  placeId: string;
  name: string;
  subject: string;
  body: string;
}

interface InstantlyCampaignResponse {
  id: string;
}

interface InstantlyLeadResponse {
  id: string;
}

interface InstantlyEmailPage {
  items: InstantlyEmail[];
  nextStartingAfter: string | null;
}

function configuredEaccount(): string {
  const value = process.env.INSTANTLY_EACCOUNT;
  const eaccount = value ? normaliseInstantlyEmail(value) : null;
  if (!eaccount) throw new Error("INSTANTLY_EACCOUNT must be a valid managed mailbox.");
  return eaccount;
}

export function assertInstantlyCampaignConfiguration(): void {
  if (process.env.INSTANTLY_CAMPAIGN_CREATION_ENABLED !== "true") {
    throw new Error("Instantly campaign creation is disabled.");
  }
  if (!instantlyActivationEnabled(process.env)) {
    throw new Error("Instantly campaign activation is disabled.");
  }
  configuredEaccount();
}

export async function withInstantlyRestaurantLock<T>(
  placeId: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!placeId || placeId.length > 512) throw new Error("Invalid restaurant lock key.");
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [placeId]);
    return await operation();
  } finally {
    await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [placeId]);
    client.release();
  }
}

/**
 * Pause all locally requested campaigns before a new send. A remote provider
 * call cannot be atomic with a local opt-out/claim; the durable intent and
 * fail-closed retry make that limitation explicit rather than pretending a
 * recall is guaranteed.
 */
export async function drainInstantlyCampaignCancellations(): Promise<void> {
  const pending = await db.select().from(instantlyCampaignCancellationTable)
    .where(isNull(instantlyCampaignCancellationTable.completedAt))
    .limit(CANCELLATION_BATCH_LIMIT);
  for (const row of pending) {
    try {
      await instantlyJson(`/v2/campaigns/${encodeURIComponent(row.campaignId)}/pause`, {
        method: "POST",
      });
      await db.update(instantlyCampaignCancellationTable).set({
        completedAt: new Date(),
        lastError: null,
      }).where(eq(instantlyCampaignCancellationTable.campaignId, row.campaignId));
    } catch {
      await db.update(instantlyCampaignCancellationTable).set({
        attempts: row.attempts + 1,
        lastError: "Instantly campaign pause was not accepted.",
      }).where(eq(instantlyCampaignCancellationTable.campaignId, row.campaignId));
      throw new Error("Instantly campaign cancellation is pending.");
    }
  }
  if (pending.length === CANCELLATION_BATCH_LIMIT) {
    const [leftover] = await db.select({ campaignId: instantlyCampaignCancellationTable.campaignId })
      .from(instantlyCampaignCancellationTable)
      .where(isNull(instantlyCampaignCancellationTable.completedAt))
      .limit(1);
    assertCancellationBatchComplete(pending.length, Boolean(leftover));
  }
}

function safeProviderId(value: unknown): string | null {
  return validInstantlyProviderId(value) ? value : null;
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function instantlyJson(path: string, init?: ProxyOptions): Promise<unknown> {
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("instantly", path, init);
  if (!response.ok) {
    // Do not surface provider bodies: they can include contact or message data.
    throw new Error("Instantly request was not accepted.");
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Instantly returned an invalid response.");
  }
}

function campaignPayload(draft: InstantlyCampaignDraft) {
  const today = utcDate();
  const text = draft.body.slice(0, MAX_REPLY_BODY_CHARS);
  return {
    // The name is operational only. It is never read to associate replies.
    name: `The Food Advisor outreach ${Date.now()}`,
    ...singleStepCampaignPayload(draft.subject, text, today),
  };
}

/**
 * Creates a one-lead, one-step campaign and records its durable ownership
 * mapping before the lead is queued. It never relies on a subject, campaign
 * name, or custom variable to map a later reply.
 *
 * Creation and activation are independently opt-in so deployment and test
 * environments cannot create campaigns or send mail merely by setting the
 * legacy OUTREACH_ENABLED flag.
 */
export async function sendInstantlyEmail(
  draft: InstantlyCampaignDraft,
  email: string,
  sequenceId: 1 | 2 | 3,
): Promise<{ campaignId: string; leadId: string; activated: boolean }> {
  return withInstantlyRestaurantLock(draft.placeId, () =>
    sendInstantlyEmailUnlocked(draft, email, sequenceId));
}

async function sendInstantlyEmailUnlocked(
  draft: InstantlyCampaignDraft,
  email: string,
  sequenceId: 1 | 2 | 3,
): Promise<{ campaignId: string; leadId: string; activated: boolean }> {
  if (!draft.placeId || draft.name.length > 500 || !draft.subject.trim() || !draft.body.trim()) {
    throw new Error("Instantly campaign draft is invalid.");
  }
  const recipientEmail = normaliseInstantlyEmail(email);
  if (!recipientEmail) throw new Error("Instantly recipient is invalid.");
  assertInstantlyCampaignConfiguration();
  const eaccount = configuredEaccount();
  const [ownedRestaurant] = await db
    .select({
      placeId: restaurantsTable.placeId,
      publicBusinessEmail: restaurantsTable.publicBusinessEmail,
    })
    .from(restaurantsTable)
    .where(and(
      eq(restaurantsTable.placeId, draft.placeId),
      isNull(restaurantsTable.suppressedAt),
      isNull(restaurantsTable.claimedAt),
      isNull(restaurantsTable.claimStatus),
      isNull(restaurantsTable.claimAttemptId),
      eq(restaurantsTable.outreachStatus, "sending"),
      eq(restaurantsTable.outreachCount, sequenceId - 1),
    ))
    .limit(1);
  if (!ownedRestaurant || normaliseInstantlyEmail(ownedRestaurant.publicBusinessEmail ?? "") !== recipientEmail) {
    throw new Error("Restaurant recipient is no longer eligible.");
  }

  const created = await instantlyJson("/v2/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(campaignPayload(draft)),
  }) as InstantlyCampaignResponse;
  const campaignId = safeProviderId(created?.id);
  if (!campaignId) throw new Error("Instantly campaign acknowledgement was invalid.");

  // Persist the provider-generated ID before the lead request. This is the
  // only mapping that a reply processor will accept.
  if (sequenceId === 1) {
    await db.insert(instantlyOutreachCampaignsTable).values({
      campaignId,
      placeId: ownedRestaurant.placeId,
      recipientEmail,
      eaccount,
      state: "campaign_created",
    });
  } else {
    await db.insert(instantlyFollowupCampaignsTable).values({
      campaignId,
      placeId: ownedRestaurant.placeId,
      emailNumber: sequenceId,
      recipientEmail,
      eaccount,
      state: "campaign_created",
    });
  }

  const lead = await instantlyJson("/v2/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      campaign: campaignId,
      email: recipientEmail,
      company_name: draft.name.slice(0, 500),
      skip_if_in_workspace: true,
      skip_if_in_campaign: true,
      // Never place a restaurant ID or other ownership marker here. The
      // provider's variables are presentation data, not a trust boundary.
      custom_variables: {},
    }),
  }) as InstantlyLeadResponse;
  const leadId = safeProviderId(lead?.id);
  if (!leadId) throw new Error("Instantly lead acknowledgement was invalid.");
  const campaignTable = sequenceId === 1
    ? instantlyOutreachCampaignsTable
    : instantlyFollowupCampaignsTable;
  await db.update(campaignTable).set({
    leadId,
    state: "lead_queued",
    queuedAt: new Date(),
  }).where(eq(campaignTable.campaignId, campaignId));

  // Deliberately off by default. Campaign activation is an explicit live-mail
  // decision; a campaign has a single lead and a same-day one-email schedule.
  if (!instantlyActivationEnabled(process.env)) {
    return { campaignId, leadId, activated: false };
  }
  const [stillEligible] = await db.select({ placeId: restaurantsTable.placeId })
    .from(restaurantsTable)
    .where(and(
      eq(restaurantsTable.placeId, ownedRestaurant.placeId),
      isNull(restaurantsTable.suppressedAt),
      isNull(restaurantsTable.claimedAt),
      isNull(restaurantsTable.claimStatus),
      isNull(restaurantsTable.claimAttemptId),
      eq(restaurantsTable.outreachStatus, "sending"),
      eq(restaurantsTable.outreachCount, sequenceId - 1),
    ))
    .limit(1);
  if (!stillEligible) {
    await db.update(campaignTable).set({ state: "activation_blocked" })
      .where(eq(campaignTable.campaignId, campaignId));
    throw new Error("Restaurant is no longer eligible for campaign activation.");
  }
  await instantlyJson(`/v2/campaigns/${encodeURIComponent(campaignId)}/activate`, {
    method: "POST",
  });
  await db.update(campaignTable).set({
    state: "activated",
    activatedAt: new Date(),
  }).where(eq(campaignTable.campaignId, campaignId));
  return { campaignId, leadId, activated: true };
}

function parseEmail(value: unknown): InstantlyEmail | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = safeProviderId(item.id);
  const campaignId = safeProviderId(item.campaign_id);
  const eaccount = typeof item.eaccount === "string" ? normaliseInstantlyEmail(item.eaccount) : null;
  const emailType = item.email_type === "received" || item.email_type === "sent"
    ? item.email_type
    : null;
  const from = typeof item.from_address_email === "string"
    ? normaliseInstantlyEmail(item.from_address_email)
    : null;
  const recipients = Array.isArray(item.to_address_email_list)
    && item.to_address_email_list.every((recipient) => typeof recipient === "string")
    ? item.to_address_email_list.map(normaliseInstantlyEmail)
    : null;
  const normalisedRecipients = recipients && recipients.every((recipient) => recipient !== null)
    ? recipients
    : null;
  const rawText = item.body && typeof item.body === "object"
    ? (item.body as Record<string, unknown>).text
    : undefined;
  const rawTimestamp = item.timestamp_email;
  const parsedTimestamp = typeof rawTimestamp === "string" ? new Date(rawTimestamp) : null;
  const sentAt = parsedTimestamp && Number.isFinite(parsedTimestamp.getTime())
    && parsedTimestamp.getTime() <= Date.now()
    ? parsedTimestamp
    : null;
  // An unreadable body is still a valid reply and will be classified unknown,
  // creating the same durable follow-up barrier as a readable one.
  const body = typeof rawText === "string" ? rawText.slice(0, MAX_REPLY_BODY_CHARS) : "";
  return campaignId
    ? { id, campaignId, eaccount, emailType, from, recipients: normalisedRecipients, body, sentAt }
    : null;
}

/**
 * Fetch received messages only. This compatibility helper reads the first
 * page; delivery code uses the resumable page API below.
 */
export async function fetchInstantlyReplies(eaccount: string): Promise<InstantlyEmail[]> {
  return (await fetchInstantlyReplyPage(eaccount)).items;
}

async function fetchInstantlyReplyPage(
  eaccount: string,
  startingAfter?: string,
): Promise<InstantlyEmailPage> {
  const trustedEaccount = configuredEaccount();
  if (normaliseInstantlyEmail(eaccount) !== trustedEaccount) {
    throw new Error("Instantly mailbox does not match the configured mailbox.");
  }
  if (startingAfter && !validInstantlyProviderId(startingAfter)) {
    throw new Error("Instantly inbox cursor was invalid.");
  }
  const response = await instantlyJson(receivedEmailsPath(trustedEaccount, startingAfter));
  if (!response || typeof response !== "object" || !Array.isArray((response as { items?: unknown }).items)) {
    throw new Error("Instantly inbox response was invalid.");
  }
  const next = (response as { next_starting_after?: unknown }).next_starting_after;
  if (next !== undefined && next !== null && !validInstantlyProviderId(next)) {
    throw new Error("Instantly inbox cursor was invalid.");
  }
  return {
    items: (response as { items: unknown[] }).items
    .slice(0, 100)
    .map(parseEmail)
    .filter((item): item is InstantlyEmail => item !== null),
    nextStartingAfter: typeof next === "string" ? next : null,
  };
}

export interface InstantlyReplyProcessingResult {
  processed: number;
  skipped: number;
  failed: number;
}

interface CampaignMapping {
  campaignId: string;
  placeId: string;
  recipientEmail: string;
  eaccount: string;
  emailNumber: 1 | 2 | 3;
  initial: boolean;
  createdAt: Date;
}

async function campaignMapping(campaignId: string): Promise<CampaignMapping | null> {
  const [initial] = await db.select().from(instantlyOutreachCampaignsTable)
    .where(eq(instantlyOutreachCampaignsTable.campaignId, campaignId)).limit(1);
  if (initial) {
    return { ...initial, emailNumber: 1, initial: true };
  }
  const [followup] = await db.select().from(instantlyFollowupCampaignsTable)
    .where(eq(instantlyFollowupCampaignsTable.campaignId, campaignId)).limit(1);
  return followup
    ? { ...followup, emailNumber: followup.emailNumber as 2 | 3, initial: false }
    : null;
}

/**
 * Classify only messages whose provider campaign ID is already durably owned
 * by this app and whose actual from/to direction and mailbox match that
 * ownership record. Provider subjects, thread ids and custom variables are deliberately
 * ignored because they are not ownership proofs.
 */
export async function processInstantlyReplies(
  replies: InstantlyEmail[],
): Promise<InstantlyReplyProcessingResult> {
  const result: InstantlyReplyProcessingResult = { processed: 0, skipped: 0, failed: 0 };
  for (const reply of replies.slice(0, 100)) {
    try {
      const mapping = await campaignMapping(reply.campaignId);
      if (!mapping) {
        result.skipped += 1;
        continue;
      }
      // A locally owned campaign with malformed direction metadata is unsafe:
      // fail the page rather than silently dropping a possible reply.
      if (!hasCompleteInstantlyDirection(reply)) {
        throw new Error("Instantly owned reply had malformed direction metadata.");
      }
      const replyId = reply.id;
      const replyFrom = reply.from;
      if (!replyId || !replyFrom) {
        throw new Error("Instantly owned reply had malformed direction metadata.");
      }
      if (!matchesInstantlyOwnership(mapping, reply)) {
        result.skipped += 1;
        continue;
      }
      const processed = await processInstantlyIncomingReply({
        placeId: mapping.placeId,
        body: reply.body,
        from: replyFrom,
        instantlyMessageId: replyId,
        instantlyCampaignId: mapping.campaignId,
        instantlyFollowup: !mapping.initial,
      });
      if (processed.status === "processed") result.processed += 1;
      else result.skipped += 1;
    } catch {
      // Deliberately do not log a provider object or reply body.
      result.failed += 1;
    }
  }
  return result;
}

const MAX_INBOX_PAGES_PER_RECONCILIATION = 20;
const MAX_CAMPAIGN_EMAIL_PAGES = 20;

/**
 * Advances a database cursor only after a page has been processed without
 * failures. It therefore resumes older inbox pages after a restart instead of
 * repeatedly reading the first 100 items and missing the backlog.
 */
export async function reconcileInstantlyInboxFully(): Promise<InstantlyReplyProcessingResult> {
  const eaccount = configuredEaccount();
  const [state] = await db.select().from(instantlyInboxStateTable)
    .where(eq(instantlyInboxStateTable.eaccount, eaccount)).limit(1);
  let cursor = state?.nextStartingAfter ?? undefined;
  // A resumed tail cannot prove messages that arrived above the saved cursor
  // were seen. Drain it, then perform one fresh top-to-bottom pass before any
  // caller is allowed to send.
  let requiresFreshPass = Boolean(cursor);
  const total: InstantlyReplyProcessingResult = { processed: 0, skipped: 0, failed: 0 };
  for (let pageNumber = 0; pageNumber < MAX_INBOX_PAGES_PER_RECONCILIATION; pageNumber += 1) {
    const page = await fetchInstantlyReplyPage(eaccount, cursor);
    const result = await processInstantlyReplies(page.items);
    total.processed += result.processed;
    total.skipped += result.skipped;
    total.failed += result.failed;
    // A failed classification must leave the cursor unchanged so the message
    // is retried before any later campaign can be sent.
    if (result.failed) throw new Error("Instantly inbox reconciliation was incomplete.");
    if (page.nextStartingAfter) {
      await db.insert(instantlyInboxStateTable).values({
        eaccount,
        nextStartingAfter: page.nextStartingAfter,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: instantlyInboxStateTable.eaccount,
        set: { nextStartingAfter: page.nextStartingAfter, updatedAt: new Date() },
      });
      cursor = page.nextStartingAfter;
      continue;
    }
    if (requiresFreshPass) {
      await db.insert(instantlyInboxStateTable).values({
        eaccount,
        nextStartingAfter: null,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: instantlyInboxStateTable.eaccount,
        set: { nextStartingAfter: null, updatedAt: new Date() },
      });
      cursor = undefined;
      requiresFreshPass = false;
      continue;
    }
    await db.insert(instantlyInboxStateTable).values({
      eaccount,
      nextStartingAfter: null,
      lastFullyReconciledAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: instantlyInboxStateTable.eaccount,
      set: {
        nextStartingAfter: null,
        lastFullyReconciledAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return total;
  }
  throw new Error("Instantly inbox reconciliation exceeded its safe page limit.");
}

async function findConfirmedCampaignSend(
  mapping: CampaignMapping,
): Promise<InstantlyEmail | null> {
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_CAMPAIGN_EMAIL_PAGES; pageNumber += 1) {
    const response = await instantlyJson(campaignEmailsPath(
      mapping.campaignId,
      mapping.eaccount,
      cursor,
    ));
    if (!response || typeof response !== "object" || !Array.isArray((response as { items?: unknown }).items)) {
      throw new Error("Instantly campaign email response was invalid.");
    }
    const items = (response as { items: unknown[] }).items
      .slice(0, 100).map(parseEmail).filter((item): item is InstantlyEmail => item !== null);
    const matchingCampaign = items.filter((item) => item.campaignId === mapping.campaignId);
    if (matchingCampaign.some((item) => !hasCompleteInstantlyDirection(item)
      || (item.emailType === "sent" && !item.sentAt))) {
      throw new Error("Instantly owned sent email had malformed delivery metadata.");
    }
    const found = items.find((item) => matchesInstantlySentOwnership(mapping, item)
      && item.sentAt !== null
      && item.sentAt.getTime() >= mapping.createdAt.getTime()
      && item.sentAt.getTime() <= Date.now());
    if (found) return found;
    const next = (response as { next_starting_after?: unknown }).next_starting_after;
    if (next === undefined || next === null) return null;
    if (!validInstantlyProviderId(next)) throw new Error("Instantly campaign cursor was invalid.");
    cursor = next;
  }
  throw new Error("Instantly campaign reconciliation exceeded its safe page limit.");
}

/**
 * Records only provider-visible outbound messages as sent. The provider's
 * timestamp, not queue time or observation time, drives the 3/7-day policy.
 */
export async function reconcileInstantlySentMessages(): Promise<number> {
  const [initial, followups] = await Promise.all([
    db.select().from(instantlyOutreachCampaignsTable),
    db.select().from(instantlyFollowupCampaignsTable),
  ]);
  const mappings: CampaignMapping[] = [
    ...initial.map((row) => ({ ...row, emailNumber: 1 as const, initial: true })),
    ...followups
      .filter((row) => row.emailNumber === 2 || row.emailNumber === 3)
      .map((row) => ({ ...row, emailNumber: row.emailNumber as 2 | 3, initial: false })),
  ];
  let reconciled = 0;
  for (const mapping of mappings) {
    const [alreadyRecorded] = await db.select({ id: instantlySentMessagesTable.messageId })
      .from(instantlySentMessagesTable)
      .where(eq(instantlySentMessagesTable.campaignId, mapping.campaignId))
      .limit(1);
    if (alreadyRecorded) continue;
    const sent = await findConfirmedCampaignSend(mapping);
    if (!sent?.sentAt || !sent.id) continue;
    const sentAt = sent.sentAt;
    const sentId = sent.id;
    const outcome = await db.transaction(async (tx) => {
      const [reserved] = await tx.insert(instantlySentMessagesTable).values({
        messageId: sentId,
        campaignId: mapping.campaignId,
        placeId: mapping.placeId,
        emailNumber: mapping.emailNumber,
        sentAt,
      }).onConflictDoNothing().returning({ messageId: instantlySentMessagesTable.messageId });
      if (!reserved) return false;
      const nextStatus = mapping.emailNumber === 1 ? "sent"
        : mapping.emailNumber === 2 ? "followup_sent" : "final_followup_sent";
      const [advanced] = await tx.update(restaurantsTable).set({
        outreachStatus: nextStatus,
        lastOutreachAt: sentAt,
        outreachCount: mapping.emailNumber,
      }).where(and(
        eq(restaurantsTable.placeId, mapping.placeId),
        // A timeout after Instantly accepted a request may have left the
        // restaurant in sending/send_failed. The durable campaign mapping plus
        // the provider-visible message is still sufficient to record the
        // actual delivery; replied/suppressed/claimed states never advance.
        or(
          eq(restaurantsTable.outreachStatus, "instantly_queued"),
          eq(restaurantsTable.outreachStatus, "sending"),
          eq(restaurantsTable.outreachStatus, "send_failed"),
        ),
        eq(restaurantsTable.outreachCount, mapping.emailNumber - 1),
        isNull(restaurantsTable.suppressedAt),
        isNull(restaurantsTable.claimedAt),
        isNull(restaurantsTable.claimStatus),
        isNull(restaurantsTable.claimAttemptId),
      )).returning({ placeId: restaurantsTable.placeId });
      await tx.insert(outreachAuditTable).values({
        placeId: mapping.placeId,
        event: "sent",
        detail: JSON.stringify({
          campaignId: mapping.campaignId,
          emailNumber: mapping.emailNumber,
        }),
        createdAt: sentAt,
      });
      const table = mapping.initial ? instantlyOutreachCampaignsTable : instantlyFollowupCampaignsTable;
      await tx.update(table).set({ state: "sent" })
        .where(eq(table.campaignId, mapping.campaignId));
      return Boolean(advanced);
    });
    if (outcome) reconciled += 1;
  }
  return reconciled;
}

export async function pollInstantlyReplies(): Promise<InstantlyReplyProcessingResult> {
  if (process.env.INSTANTLY_REPLY_POLLING_ENABLED !== "true") {
    throw new Error("Instantly reply polling is disabled.");
  }
  return reconcileInstantlyInboxFully();
}