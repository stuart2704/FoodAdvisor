import {
  db,
  outreachAuditTable,
  processedGmailMessagesTable,
  restaurantsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
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

type ProcessResult =
  | { status: "processed"; classification: ReplyClassification }
  | { status: "duplicate" }
  | { status: "not_found" };

async function applyReply(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: IncomingReply,
  classification: ReplyClassification,
): Promise<boolean> {
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
  return db.transaction(async (tx) => {
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
}