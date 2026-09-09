import {
  db,
  gmailOutreachThreadsTable,
  processedGmailMessagesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  decodeBoundedPlainText,
  getFullMessage,
  getHeader,
  getMessageSummary,
  listThreadMessages,
  searchInboxThreads,
} from "./gmailClient";
import { processGmailIncomingReply } from "../replyClassifier/processIncomingReply";

const MAX_INBOUND_PER_RUN = 20;

export interface GmailMessageProcessingResult {
  processed: number;
  skipped: number;
  failed: number;
  capped: boolean;
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