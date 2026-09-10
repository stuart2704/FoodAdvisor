import {
  db,
  outreachAuditTable,
  processedGmailMessagesTable,
  processedInstantlyFollowupMessagesTable,
  processedInstantlyMessagesTable,
  restaurantsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logEvent } from "../../utils/eventLog";
import { enqueueAllInstantlyCancellationIntents } from "../instantly/cancellationIntents";
import { classifyReply, type ReplyClassification } from "./classifyReply";

function senderDomain(from: string | undefined): string | undefined {
  if (!from) return undefined;
  const match = from.match(/@([a-z0-9.-]+\.[a-z]{2,})(?:>|\s|$)/i);
  return match?.[1]?.toLowerCase();
}

interface IncomingReply {
  placeId: string;
  body: string;
  from?: string;
}

interface GmailIncomingReply extends IncomingReply {
  gmailMessageId: string;
  gmailThreadId: string;
}

interface InstantlyIncomingReply extends IncomingReply {
  instantlyMessageId: string;
  instantlyCampaignId: string;
  instantlyFollowup: boolean;
}

type ProcessResult =
  | { status: "processed"; classification: ReplyClassification }
  | { status: "duplicate" }
  | { status: "not_found" };

async function applyReply(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: IncomingReply,
  classification: ReplyClassification,
): Promise<boolean> {
  // Matches the session-level restaurant lock held during Instantly
  // eligibility/activation, so a local stop-state and pause intents commit
  // together without an in-process send interleaving.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.placeId}, 0))`);
  const suppress =
    classification.category === "unsubscribe" ||
    classification.category === "wrong_contact" ||
    classification.category === "not_interested";
  const outreachStatus =
    classification.category === "unknown" ? "replied" : classification.category;
  const [restaurant] = await tx
    .update(restaurantsTable)
    .set(
      suppress
        ? {
            outreachStatus: "suppressed",
            suppressedAt: new Date(),
            suppressionReason: classification.category,
            publicBusinessEmail: null,
          }
        : { outreachStatus },
    )
    .where(eq(restaurantsTable.placeId, input.placeId))
    .returning({ placeId: restaurantsTable.placeId });
  if (!restaurant) return false;
  await tx.insert(outreachAuditTable).values({
    placeId: restaurant.placeId,
    event: "reply_classified",
    recipientDomain: senderDomain(input.from),
    detail: JSON.stringify({
      category: classification.category,
      confidence: classification.confidence,
    }),
  });
  if (suppress) {
    await enqueueAllInstantlyCancellationIntents(tx, restaurant.placeId);
  }
  return true;
}

export async function processIncomingReply(
  input: IncomingReply,
): Promise<ProcessResult> {
  const classification = classifyReply(input.body);
  const found = await db.transaction((tx) => applyReply(tx, input, classification));
  return found
    ? { status: "processed", classification }
    : { status: "not_found" };
}

export async function processGmailIncomingReply(
  input: GmailIncomingReply,
): Promise<ProcessResult> {
  const classification = classifyReply(input.body);
  const result = await db.transaction<ProcessResult>(async (tx) => {
    const [reserved] = await tx
      .insert(processedGmailMessagesTable)
      .values({
        messageId: input.gmailMessageId,
        threadId: input.gmailThreadId,
        placeId: input.placeId,
      })
      .onConflictDoNothing()
      .returning({ messageId: processedGmailMessagesTable.messageId });
    if (!reserved) return { status: "duplicate" };
    const found = await applyReply(tx, input, classification);
    if (!found) {
      // Throwing rolls back the idempotency reservation, permitting a safe retry.
      throw new Error("Mapped restaurant was not found.");
    }
    return { status: "processed", classification };
  });
  // Record success only after the transaction has committed.
  if (result.status === "processed") logEvent("success", "Reply processed");
  return result;
}

/**
 * The campaign mapping and recipient/eaccount checks happen before this
 * function is called. The immutable Instantly message id is still reserved
 * transactionally to make polling safe to retry.
 */
export async function processInstantlyIncomingReply(
  input: InstantlyIncomingReply,
): Promise<ProcessResult> {
  const classification = classifyReply(input.body);
  const result = await db.transaction<ProcessResult>(async (tx) => {
    const [reserved] = input.instantlyFollowup
      ? await tx.insert(processedInstantlyFollowupMessagesTable).values({
          messageId: input.instantlyMessageId,
          campaignId: input.instantlyCampaignId,
          placeId: input.placeId,
        }).onConflictDoNothing()
          .returning({ messageId: processedInstantlyFollowupMessagesTable.messageId })
      : await tx.insert(processedInstantlyMessagesTable).values({
          messageId: input.instantlyMessageId,
          campaignId: input.instantlyCampaignId,
          placeId: input.placeId,
        }).onConflictDoNothing()
          .returning({ messageId: processedInstantlyMessagesTable.messageId });
    if (!reserved) return { status: "duplicate" };
    const found = await applyReply(tx, input, classification);
    if (!found) {
      throw new Error("Mapped restaurant was not found.");
    }
    return { status: "processed", classification };
  });
  if (result.status === "processed") logEvent("success", "Instantly reply processed");
  return result;
}