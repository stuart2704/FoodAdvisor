import {
  db,
  gmailHistoryMessagesTable,
  gmailOutreachThreadsTable,
  gmailWatchStateTable,
} from "@workspace/db";
import { and, asc, desc, eq, gt, lte } from "drizzle-orm";
import { getGmailProfile, GmailHttpError, listThreadMessages } from "./gmailClient";
import { drainStagedGmailMessages } from "./gmailWebhookHandler";

// A single request only reads five known threads (at most 5,000 message
// summaries per thread). The operator carries the returned keyset cursor to
// the next request; a failed request can be replayed safely.
const THREADS_PER_PAGE = 5;
const validCursor = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 255 &&
  !/[\u0000-\u001f\u007f]/.test(value);

export function parseStoredThreadRecoveryRequest(value: unknown):
  | { after?: string; through?: string }
  | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["confirm", "after", "through"].includes(key)) ||
      body.confirm !== "recover-stored-outreach-threads" ||
      (body.after !== undefined && !validCursor(body.after)) ||
      (body.through !== undefined && !validCursor(body.through)) ||
      (body.after !== undefined && body.through === undefined) ||
      (body.after !== undefined && (body.after as string) > (body.through as string))) return null;
  return { after: body.after as string | undefined, through: body.through as string | undefined };
}

export async function recoverStoredOutreachThreads(input: {
  after?: string;
  through?: string;
}) {
  const accounts = await db.select({ accountEmail: gmailWatchStateTable.accountEmail })
    .from(gmailWatchStateTable).limit(2);
  if (accounts.length !== 1) throw new Error("Exactly one managed Gmail account is required.");
  const accountEmail = accounts[0].accountEmail;
  const profile = await getGmailProfile();
  if (profile.emailAddress !== accountEmail.toLowerCase()) {
    throw new Error("Gmail connector does not match the managed account.");
  }

  // Freeze the end of this run so newly stored outreach cannot prolong it.
  let through = input.through;
  if (!through) {
    const [last] = await db.select({ threadId: gmailOutreachThreadsTable.threadId })
      .from(gmailOutreachThreadsTable).orderBy(desc(gmailOutreachThreadsTable.threadId)).limit(1);
    through = last?.threadId;
  }
  const rows = through ? await db.select({
    threadId: gmailOutreachThreadsTable.threadId,
    sentMessageId: gmailOutreachThreadsTable.sentMessageId,
  }).from(gmailOutreachThreadsTable)
    .where(and(
      lte(gmailOutreachThreadsTable.threadId, through),
      input.after ? gt(gmailOutreachThreadsTable.threadId, input.after) : undefined,
    ))
    .orderBy(asc(gmailOutreachThreadsTable.threadId))
    .limit(THREADS_PER_PAGE + 1) : [];
  const page = rows.slice(0, THREADS_PER_PAGE);
  let staged = 0;
  let missingThreads = 0;
  for (const row of page) {
    let messages;
    try {
      messages = await listThreadMessages(row.threadId);
    } catch (error) {
      if (!(error instanceof GmailHttpError) || error.status !== 404) throw error;
      missingThreads += 1;
      continue;
    }
    await db.transaction(async tx => {
      for (const message of messages) {
        if (message.id === row.sentMessageId ||
            message.labelIds.some(label => label === "SENT" || label === "DRAFT")) continue;
        const inserted = await tx.insert(gmailHistoryMessagesTable).values({
          accountEmail, messageId: message.id, threadId: row.threadId,
          status: "pending", updatedAt: new Date(),
        }).onConflictDoNothing().returning({ messageId: gmailHistoryMessagesTable.messageId });
        staged += inserted.length;
      }
    });
  }
  // A retry may encounter already staged IDs; the primary key and downstream
  // processed-message ledger prevent a second classification.
  const drain = await drainStagedGmailMessages(accountEmail);
  return {
    inspectedThreads: page.length,
    missingThreads,
    stagedReferences: staged,
    processed: drain.processed,
    skipped: drain.skipped,
    failed: drain.failed,
    pending: drain.capped,
    through: through ?? null,
    hasMoreThreads: rows.length > THREADS_PER_PAGE,
    // Keep a cursor even on the final page, so an operator can invoke an
    // empty page to drain pending rows after the thread scan has finished.
    nextAfter: page.at(-1)?.threadId ?? input.after ?? null,
  };
}