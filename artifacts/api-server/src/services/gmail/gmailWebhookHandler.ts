import {
  db,
  gmailHistoryMessagesTable,
  gmailOutreachThreadsTable,
  processedGmailMessagesTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import {
  decodeBoundedPlainText,
  GmailHttpError,
  getFullMessage,
  getHeader,
  getMessageSummary,
  listThreadMessages,
  searchInboxThreads,
} from "./gmailClient";
import { processGmailIncomingReply } from "../replyClassifier/processIncomingReply";
import {
  isPermanentGmailMessageStatus,
  summaryFetchFailureTransition,
} from "./gmailContracts";

const MAX_INBOUND_PER_RUN = 20;

export interface GmailMessageProcessingResult {
  processed: number;
  skipped: number;
  failed: number;
  capped: boolean;
}

function permanentGmailFailure(error: unknown): boolean {
  return error instanceof GmailHttpError
    ? isPermanentGmailMessageStatus(error.status)
    : false;
}

export async function stageGmailRecovery(
  accountEmail: string,
): Promise<void> {
  const threadIds = await searchInboxThreads();
  for (const threadId of threadIds) {
    const summaries = await listThreadMessages(threadId);
    await db.transaction(async (tx) => {
      for (const message of summaries) {
        await tx
          .insert(gmailHistoryMessagesTable)
          .values({
            accountEmail,
            messageId: message.id,
            threadId: message.threadId,
            status: "pending",
            updatedAt: new Date(),
          })
          .onConflictDoNothing();
      }
    });
  }
}

export async function drainStagedGmailMessages(
  accountEmail: string,
): Promise<GmailMessageProcessingResult> {
  const rows = await db
    .select()
    .from(gmailHistoryMessagesTable)
    .where(
      and(
        eq(gmailHistoryMessagesTable.status, "pending"),
        eq(gmailHistoryMessagesTable.accountEmail, accountEmail),
        or(
          isNull(gmailHistoryMessagesTable.nextAttemptAt),
          lte(gmailHistoryMessagesTable.nextAttemptAt, new Date()),
        ),
      ),
    )
    .limit(MAX_INBOUND_PER_RUN);
  const result: GmailMessageProcessingResult = {
    processed: 0,
    skipped: 0,
    failed: 0,
    capped: false,
  };
  for (const row of rows) {
    await db
      .update(gmailHistoryMessagesTable)
      .set({
        attempts: row.attempts + 1,
        updatedAt: new Date(),
        nextAttemptAt: null,
      })
      .where(eq(gmailHistoryMessagesTable.messageId, row.messageId));
    try {
      let summary: Awaited<ReturnType<typeof getMessageSummary>>;
      try {
        summary = await getMessageSummary(row.messageId);
      } catch (error) {
        const transition = summaryFetchFailureTransition(error, new Date());
        await db
          .update(gmailHistoryMessagesTable)
          .set({
            status: transition.status,
            tombstonedAt: transition.tombstonedAt,
            nextAttemptAt: transition.nextAttemptAt,
            updatedAt: new Date(),
          })
          .where(eq(gmailHistoryMessagesTable.messageId, row.messageId));
        if (transition.status === "skipped") result.skipped += 1;
        else result.failed += 1;
        continue;
      }
      if (summary.threadId !== row.threadId) {
        await db
          .update(gmailHistoryMessagesTable)
          .set({ status: "skipped", tombstonedAt: new Date(), updatedAt: new Date() })
          .where(eq(gmailHistoryMessagesTable.messageId, row.messageId));
        result.skipped += 1;
        continue;
      }
      const [mapping] = await db
        .select()
        .from(gmailOutreachThreadsTable)
        .where(eq(gmailOutreachThreadsTable.threadId, row.threadId))
        .limit(1);
      if (!mapping || summary.id === mapping.sentMessageId || summary.labelIds.includes("SENT")) {
        await db
          .update(gmailHistoryMessagesTable)
          .set({ status: "skipped", tombstonedAt: new Date(), updatedAt: new Date() })
          .where(eq(gmailHistoryMessagesTable.messageId, row.messageId));
        result.skipped += 1;
        continue;
      }
      let message: Awaited<ReturnType<typeof getFullMessage>>;
      try {
        message = await getFullMessage(row.messageId);
        const body = decodeBoundedPlainText(message);
        if (!body || message.threadId !== row.threadId || message.labelIds.includes("SENT")) {
          await db
            .update(gmailHistoryMessagesTable)
            .set({ status: "skipped", tombstonedAt: new Date(), updatedAt: new Date() })
            .where(eq(gmailHistoryMessagesTable.messageId, row.messageId));
          result.skipped += 1;
          continue;
        }
        const processed = await processGmailIncomingReply({
          placeId: mapping.placeId,
          body,
          from: getHeader(message, "from"),
          gmailMessageId: message.id,
          gmailThreadId: row.threadId,
        });
        await db
          .update(gmailHistoryMessagesTable)
          .set({ status: "processed", updatedAt: new Date() })
          .where(eq(gmailHistoryMessagesTable.messageId, row.messageId));
        if (processed.status === "processed") result.processed += 1;
        else result.skipped += 1;
      } catch (error) {
        if (!permanentGmailFailure(error) && !(error instanceof Error && /size limit|MIME structure|response was invalid|identifiers were invalid/.test(error.message))) {
          throw error;
        }
        await db
          .update(gmailHistoryMessagesTable)
          .set({ status: "skipped", tombstonedAt: new Date(), updatedAt: new Date() })
          .where(eq(gmailHistoryMessagesTable.messageId, row.messageId));
        result.skipped += 1;
      }
    } catch (error) {
      if (permanentGmailFailure(error)) {
        await db
          .update(gmailHistoryMessagesTable)
          .set({ status: "skipped", tombstonedAt: new Date(), updatedAt: new Date() })
          .where(eq(gmailHistoryMessagesTable.messageId, row.messageId));
        result.skipped += 1;
      } else {
        await db
          .update(gmailHistoryMessagesTable)
          .set({
            nextAttemptAt: new Date(Date.now() + 30_000),
            updatedAt: new Date(),
          })
          .where(eq(gmailHistoryMessagesTable.messageId, row.messageId));
        result.failed += 1;
      }
    }
  }
  const [pending] = await db
    .select({ count: gmailHistoryMessagesTable.messageId })
    .from(gmailHistoryMessagesTable)
    .where(
      and(
        eq(gmailHistoryMessagesTable.accountEmail, accountEmail),
        eq(gmailHistoryMessagesTable.status, "pending"),
      ),
    )
    .limit(1);
  // This includes deferred transient rows, not only rows eligible right now.
  result.capped = Boolean(pending);
  return result;
}

export async function processGmailMessageIds(
  inputIds: string[],
): Promise<GmailMessageProcessingResult> {
  const result: GmailMessageProcessingResult = {
    processed: 0,
    skipped: 0,
    failed: 0,
    capped: false,
  };
  let attempted = 0;
  for (const messageId of [...new Set(inputIds)]) {
    const prior = await db
      .select({ messageId: processedGmailMessagesTable.messageId })
      .from(processedGmailMessagesTable)
      .where(eq(processedGmailMessagesTable.messageId, messageId))
      .limit(1);
    if (prior.length) {
      result.skipped += 1;
      continue;
    }
    try {
      const summary = await getMessageSummary(messageId);
      const [mapping] = await db
        .select()
        .from(gmailOutreachThreadsTable)
        .where(eq(gmailOutreachThreadsTable.threadId, summary.threadId))
        .limit(1);
      if (
        !mapping ||
        summary.id === mapping.sentMessageId ||
        summary.labelIds.includes("SENT")
      ) {
        result.skipped += 1;
        continue;
      }
      if (attempted >= MAX_INBOUND_PER_RUN) {
        result.capped = true;
        break;
      }
      attempted += 1;
      const message = await getFullMessage(messageId);
      if (
        message.threadId !== mapping.threadId ||
        message.id === mapping.sentMessageId ||
        message.labelIds.includes("SENT")
      ) {
        result.skipped += 1;
        continue;
      }
      const body = decodeBoundedPlainText(message);
      if (!body) {
        result.skipped += 1;
        continue;
      }
      const processed = await processGmailIncomingReply({
        placeId: mapping.placeId,
        body,
        from: getHeader(message, "from"),
        gmailMessageId: message.id,
        gmailThreadId: mapping.threadId,
      });
      if (processed.status === "processed") result.processed += 1;
      else result.skipped += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export interface GmailPollingResult {
  searchedThreads: number;
  matchedThreads: number;
  processed: number;
  skipped: number;
  failed: number;
  capped: boolean;
  errors: string[];
}

/**
 * Read-only Gmail polling entry point. The legacy filename is retained by
 * request, but this is intentionally not a webhook or push handler.
 */
export async function pollGmailReplies(): Promise<GmailPollingResult> {
  let attempted = 0;
  const result: GmailPollingResult = {
    searchedThreads: 0,
    matchedThreads: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    capped: false,
    errors: [],
  };
  const threadIds = [...new Set(await searchInboxThreads())];
  result.searchedThreads = threadIds.length;
  if (!threadIds.length) return result;

  const mappings = await db
    .select()
    .from(gmailOutreachThreadsTable)
    .where(inArray(gmailOutreachThreadsTable.threadId, threadIds));
  result.matchedThreads = mappings.length;

  for (const mapping of mappings) {
    if (attempted >= MAX_INBOUND_PER_RUN) {
      result.capped = true;
      break;
    }
    try {
      const summaries = await listThreadMessages(mapping.threadId);
      const eligible = summaries.filter(
        (message) =>
          message.threadId === mapping.threadId &&
          message.id !== mapping.sentMessageId &&
          !message.labelIds.includes("SENT"),
      );
      if (!eligible.length) {
        result.skipped += 1;
        continue;
      }
      const ids = eligible.map((message) => message.id);
      const prior = await db
        .select({ messageId: processedGmailMessagesTable.messageId })
        .from(processedGmailMessagesTable)
        .where(inArray(processedGmailMessagesTable.messageId, ids));
      const priorIds = new Set(prior.map((row) => row.messageId));

      for (const summary of eligible) {
        if (priorIds.has(summary.id)) {
          result.skipped += 1;
          continue;
        }
        if (attempted >= MAX_INBOUND_PER_RUN) {
          result.capped = true;
          break;
        }
        attempted += 1;
        try {
          const message = await getFullMessage(summary.id);
          if (
            message.threadId !== mapping.threadId ||
            message.labelIds.includes("SENT") ||
            message.id === mapping.sentMessageId
          ) {
            result.skipped += 1;
            continue;
          }
          const body = decodeBoundedPlainText(message);
          if (!body) {
            result.skipped += 1;
            continue;
          }
          const processed = await processGmailIncomingReply({
            placeId: mapping.placeId,
            body,
            from: getHeader(message, "from"),
            gmailMessageId: message.id,
            gmailThreadId: mapping.threadId,
          });
          if (processed.status === "processed") result.processed += 1;
          else result.skipped += 1;
        } catch {
          result.failed += 1;
          if (result.errors.length < MAX_INBOUND_PER_RUN) {
            result.errors.push("An inbound message could not be processed.");
          }
        }
      }
    } catch {
      result.failed += 1;
      if (result.errors.length < MAX_INBOUND_PER_RUN) {
        result.errors.push("A matched Gmail thread could not be inspected.");
      }
    }
  }
  return result;
}