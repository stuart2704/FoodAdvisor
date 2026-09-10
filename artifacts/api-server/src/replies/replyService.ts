import {
  db, gmailHistoryMessagesTable, gmailOutreachThreadsTable,
  gmailWatchStateTable,
  restaurantsTable,
} from "@workspace/db";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import {
  getFullMessage, decodeBoundedPlainText, getHeader,
} from "../services/gmail/gmailClient";
import { processGmailIncomingReply } from "../services/replyClassifier/processIncomingReply";
import { logEvent } from "../utils/eventLog";
import { mapReplyIntent } from "./classifier";
import { toReplyIntentLabel } from "./replyClassifier";
import { generateReplyMessage } from "./replyGenerator";

async function getWatchAccount(): Promise<string | null> {
  const states = await db.select().from(gmailWatchStateTable).limit(2);
  if (states.length > 1) throw new Error("Managed Gmail account is ambiguous.");
  return states[0]?.accountEmail ?? null;
}

/**
 * Reads up to 20 due, staged message references. Does not poll Gmail, invent
 * replies, expose message bodies, or advance the Gmail history cursor.
 */
export async function getNewReplies() {
  logEvent("info", "Checking staged Gmail replies");
  try {
    const account = await getWatchAccount();
    if (!account) {
      logEvent("warning", "No Gmail watch configured; no staged replies available");
      return [];
    }
    return await db.select({
      gmailMessageId: gmailHistoryMessagesTable.messageId,
      gmailThreadId: gmailHistoryMessagesTable.threadId,
    }).from(gmailHistoryMessagesTable).where(and(
      eq(gmailHistoryMessagesTable.accountEmail, account),
      eq(gmailHistoryMessagesTable.status, "pending"),
      or(isNull(gmailHistoryMessagesTable.nextAttemptAt),
        lte(gmailHistoryMessagesTable.nextAttemptAt, new Date())),
    )).orderBy(gmailHistoryMessagesTable.updatedAt).limit(20);
  } catch {
    logEvent("error", "Staged Gmail replies could not be read");
    throw new Error("Staged replies are unavailable; retry later.");
  }
}

/**
 * Internal adapter only; no public route or automatic response sender.
 * Caller-supplied bodies, email addresses, and restaurant IDs are not trusted.
 * Only a due Pub/Sub-staged message mapped to known outreach is processed.
 */
export async function handleReply(reply: unknown) {
  const messageId = reply && typeof reply === "object" && !Array.isArray(reply)
    ? (reply as Record<string, unknown>).gmailMessageId : undefined;
  if (typeof messageId !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(messageId)) {
    throw new Error("A staged Gmail message ID is required.");
  }
  logEvent("info", "Processing staged Gmail reply");
  try {
    const account = await getWatchAccount();
    if (!account) throw new Error("Gmail watch is not configured.");
    const [staged] = await db.select().from(gmailHistoryMessagesTable).where(and(
      eq(gmailHistoryMessagesTable.messageId, messageId),
      eq(gmailHistoryMessagesTable.accountEmail, account),
      eq(gmailHistoryMessagesTable.status, "pending"),
      or(isNull(gmailHistoryMessagesTable.nextAttemptAt),
        lte(gmailHistoryMessagesTable.nextAttemptAt, new Date())),
    )).limit(1);
    if (!staged) return { status: "not_pending" as const };
    const [mapping] = await db.select().from(gmailOutreachThreadsTable)
      .where(eq(gmailOutreachThreadsTable.threadId, staged.threadId)).limit(1);
    if (!mapping || messageId === mapping.sentMessageId) {
      return { status: "skipped" as const };
    }
    const message = await getFullMessage(messageId);
    if (message.id !== messageId || message.threadId !== mapping.threadId
      || message.labelIds.includes("SENT")) {
      return { status: "skipped" as const };
    }
    const body = decodeBoundedPlainText(message);
    if (!body) return { status: "skipped" as const };
    const [restaurant] = await db.select({ name: restaurantsTable.name })
      .from(restaurantsTable).where(eq(restaurantsTable.placeId, mapping.placeId)).limit(1);
    if (!restaurant) throw new Error("Restaurant mapping is missing.");
    const result = await processGmailIncomingReply({
      placeId: mapping.placeId,
      body,
      from: getHeader(message, "from"),
      gmailMessageId: messageId,
      gmailThreadId: mapping.threadId,
    });
    if (result.status === "not_found") throw new Error("Restaurant mapping is missing.");
    await db.update(gmailHistoryMessagesTable).set({
      status: "processed", updatedAt: new Date(), nextAttemptAt: null,
    }).where(and(
      eq(gmailHistoryMessagesTable.messageId, messageId),
      eq(gmailHistoryMessagesTable.accountEmail, account),
    ));
    if (result.status === "duplicate") return { status: "duplicate" as const };
    const intent = result.classification.category;
    const newStatus = ["unsubscribe", "wrong_contact", "not_interested"].includes(intent)
      ? "suppressed" : intent === "unknown" ? "replied" : intent;
    const draft = newStatus === "suppressed" || intent === "out_of_office"
      ? null
      : generateReplyMessage(mapReplyIntent(result.classification), {
          restaurantName: restaurant.name,
        });
    return {
      status: "processed" as const,
      intent: mapReplyIntent(result.classification),
      intentLabel: toReplyIntentLabel(mapReplyIntent(result.classification)),
      classification: result.classification,
      newStatus,
      responseDraft: draft,
      // Compatibility name only; the response is template-based, not AI-generated.
      aiResponse: draft,
      responseGeneration: "template" as const,
      requiresReview: draft !== null,
    };
  } catch {
    logEvent("error", "Reply processing failed; staged message remains available for retry");
    throw new Error("Reply processing could not be completed; retry later.");
  }
}