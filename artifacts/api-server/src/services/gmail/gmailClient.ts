import { ReplitConnectors } from "@replit/connectors-sdk";

export const GMAIL_REPLY_QUERY = "in:inbox newer_than:30d -from:me";
export const GMAIL_SEARCH_PAGE_SIZE = 50;

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  labelIds: string[];
}

export interface GmailMessage extends GmailMessageSummary {
  payload?: GmailMessagePart;
}

interface GmailMessagePart {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailMessagePart[];
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255;
}

async function gmailJson(path: string): Promise<unknown> {
  // Connector clients must be created per operation because OAuth tokens refresh.
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("google-mail", path, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Gmail connector returned HTTP ${response.status}.`);
  }
  return response.json();
}

export async function searchInboxThreads(): Promise<string[]> {
  const query = new URLSearchParams({
    q: GMAIL_REPLY_QUERY,
    pageSize: String(GMAIL_SEARCH_PAGE_SIZE),
  });
  const value = await gmailJson(
    `/gmail/v1/users/me/threads:search?${query.toString()}`,
  );
  const threads =
    typeof value === "object" && value !== null
      ? (value as { threads?: unknown }).threads
      : undefined;
  if (threads === undefined) return [];
  if (!Array.isArray(threads)) throw new Error("Gmail thread search was invalid.");
  return threads
    .map((thread) =>
      typeof thread === "object" && thread !== null
        ? (thread as { id?: unknown }).id
        : undefined,
    )
    .filter(validId)
    .slice(0, GMAIL_SEARCH_PAGE_SIZE);
}

export async function listThreadMessages(
  threadId: string,
): Promise<GmailMessageSummary[]> {
  const value = await gmailJson(
    `/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=minimal`,
  );
  const messages =
    typeof value === "object" && value !== null
      ? (value as { messages?: unknown }).messages
      : undefined;
  if (!Array.isArray(messages)) {
    throw new Error("Gmail thread response was invalid.");
  }
  // A pathological thread must not create unbounded database or network work.
  return messages.slice(0, 200).flatMap((message) => {
    if (typeof message !== "object" || message === null) return [];
    const item = message as {
      id?: unknown;
      threadId?: unknown;
      labelIds?: unknown;
    };
    if (!validId(item.id) || !validId(item.threadId)) return [];
    return [{
      id: item.id,
      threadId: item.threadId,
      labelIds: Array.isArray(item.labelIds)
        ? item.labelIds.filter((label): label is string => typeof label === "string")
        : [],
    }];
  });
}

export async function getFullMessage(messageId: string): Promise<GmailMessage> {
  const value = await gmailJson(
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
  );
  if (typeof value !== "object" || value === null) {
    throw new Error("Gmail message response was invalid.");
  }
  const item = value as {
    id?: unknown;
    threadId?: unknown;
    labelIds?: unknown;
    payload?: GmailMessagePart;
  };
  if (!validId(item.id) || !validId(item.threadId)) {
    throw new Error("Gmail message identifiers were invalid.");
  }
  return {
    id: item.id,
    threadId: item.threadId,
    labelIds: Array.isArray(item.labelIds)
      ? item.labelIds.filter((label): label is string => typeof label === "string")
      : [],
    payload: item.payload,
  };
}

export function getHeader(
  message: GmailMessage,
  name: string,
): string | undefined {
  const value = message.payload?.headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  )?.value;
  return typeof value === "string" && value.length <= 1_000 ? value : undefined;
}

const MAX_BODY_BYTES = 10_000;
const MAX_MIME_NODES = 100;
const MAX_MIME_DEPTH = 10;

export function decodeBoundedPlainText(message: GmailMessage): string | null {
  let visited = 0;
  let bytes = 0;
  const chunks: string[] = [];

  function visit(part: GmailMessagePart, depth: number): void {
    visited += 1;
    if (visited > MAX_MIME_NODES || depth > MAX_MIME_DEPTH) {
      throw new Error("Gmail MIME structure exceeded safety limits.");
    }
    if (part.mimeType?.toLowerCase().startsWith("text/plain") && part.body?.data) {
      // Reject before decoding to avoid allocating an unexpectedly large body.
      if (
        (typeof part.body.size === "number" && part.body.size > MAX_BODY_BYTES) ||
        part.body.data.length > Math.ceil(MAX_BODY_BYTES * 4 / 3) + 8 ||
        !/^[A-Za-z0-9_-]*={0,2}$/.test(part.body.data)
      ) {
        throw new Error("Gmail reply body exceeded the size limit.");
      }
      const decoded = Buffer.from(part.body.data, "base64url");
      bytes += decoded.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        throw new Error("Gmail reply body exceeded the size limit.");
      }
      chunks.push(decoded.toString("utf8"));
    }
    for (const child of part.parts ?? []) visit(child, depth + 1);
  }

  if (message.payload) visit(message.payload, 0);
  const body = chunks.join("\n").trim();
  return body || null;
}