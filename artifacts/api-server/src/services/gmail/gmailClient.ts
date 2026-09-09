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

export function validHistoryId(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value)) return false;
  try {
    return BigInt(value) <= 18_446_744_073_709_551_615n;
  } catch {
    return false;
  }
}

export class GmailHttpError extends Error {
  constructor(public readonly status: number) {
    super("Gmail connector request failed.");
  }
}

export async function gmailJson(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<unknown> {
  // Connector clients must be created per operation because OAuth tokens refresh.
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("google-mail", path, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    throw new GmailHttpError(response.status);
  }
  return response.json();
}

export async function getGmailProfile(): Promise<{ emailAddress: string }> {
  const value = await gmailJson("/gmail/v1/users/me/profile");
  const emailAddress =
    typeof value === "object" && value !== null
      ? (value as { emailAddress?: unknown }).emailAddress
      : undefined;
  if (
    typeof emailAddress !== "string" ||
    emailAddress.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)
  ) {
    throw new Error("Gmail profile response was invalid.");
  }
  return { emailAddress: emailAddress.toLowerCase() };
}

export interface GmailWatch {
  historyId: string;
  expiration: Date;
}

export async function activateGmailWatch(topicName: string): Promise<GmailWatch> {
  if (!/^projects\/[^/]+\/topics\/[^/]+$/.test(topicName) || topicName.length > 255) {
    throw new Error("Gmail Pub/Sub topic is invalid.");
  }
  const value = await gmailJson("/gmail/v1/users/me/watch", {
    method: "POST",
    body: {
      topicName,
      labelIds: ["INBOX"],
      labelFilterBehavior: "include",
    },
  });
  const item =
    typeof value === "object" && value !== null
      ? (value as { historyId?: unknown; expiration?: unknown })
      : {};
  if (
    !validHistoryId(item.historyId) ||
    typeof item.expiration !== "string" ||
    !/^[1-9]\d{12}$/.test(item.expiration)
  ) {
    throw new Error("Gmail watch response was invalid.");
  }
  const expiration = new Date(Number(item.expiration));
  if (!Number.isFinite(expiration.getTime()) || expiration <= new Date()) {
    throw new Error("Gmail watch expiration was invalid.");
  }
  return { historyId: item.historyId, expiration };
}

export interface GmailHistoryResult {
  messageIds: string[];
  historyId: string;
}

const HISTORY_PAGE_SIZE = 100;
const HISTORY_MAX_PAGES = 10;
const HISTORY_MAX_MESSAGES = 500;

export async function listGmailHistory(startHistoryId: string): Promise<GmailHistoryResult> {
  if (!validHistoryId(startHistoryId)) throw new Error("Gmail history cursor is invalid.");
  let pageToken: string | undefined;
  let latestHistoryId: string | undefined;
  const ids = new Set<string>();
  for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      labelId: "INBOX",
      maxResults: String(HISTORY_PAGE_SIZE),
    });
    if (pageToken) query.set("pageToken", pageToken);
    const value = await gmailJson(`/gmail/v1/users/me/history?${query.toString()}`);
    if (typeof value !== "object" || value === null) {
      throw new Error("Gmail history response was invalid.");
    }
    const item = value as {
      history?: unknown;
      historyId?: unknown;
      nextPageToken?: unknown;
    };
    if (!validHistoryId(item.historyId)) {
      throw new Error("Gmail history response was invalid.");
    }
    latestHistoryId = item.historyId;
    if (item.history !== undefined && !Array.isArray(item.history)) {
      throw new Error("Gmail history response was invalid.");
    }
    for (const record of item.history ?? []) {
      if (typeof record !== "object" || record === null) {
        throw new Error("Gmail history response was invalid.");
      }
      const added = (record as { messagesAdded?: unknown }).messagesAdded;
      if (added !== undefined && !Array.isArray(added)) {
        throw new Error("Gmail history response was invalid.");
      }
      for (const entry of added ?? []) {
        const message =
          typeof entry === "object" && entry !== null
            ? (entry as { message?: unknown }).message
            : undefined;
        const id =
          typeof message === "object" && message !== null
            ? (message as { id?: unknown }).id
            : undefined;
        if (!validId(id)) throw new Error("Gmail history message was invalid.");
        ids.add(id);
        if (ids.size > HISTORY_MAX_MESSAGES) {
          throw new Error("Gmail history exceeded its safety limit.");
        }
      }
    }
    if (item.nextPageToken === undefined) {
      return { messageIds: [...ids], historyId: latestHistoryId };
    }
    if (!validId(item.nextPageToken)) {
      throw new Error("Gmail history page token was invalid.");
    }
    pageToken = item.nextPageToken;
  }
  throw new Error("Gmail history exceeded its page limit.");
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
  if (
    !validId(item.id) ||
    item.id !== messageId ||
    !validId(item.threadId) ||
    !Array.isArray(item.labelIds) ||
    !item.labelIds.every((label) => typeof label === "string" && label.length <= 255)
  ) {
    throw new Error("Gmail message identifiers were invalid.");
  }
  return {
    id: item.id,
    threadId: item.threadId,
    labelIds: item.labelIds,
    payload: item.payload,
  };
}

export async function getMessageSummary(messageId: string): Promise<GmailMessageSummary> {
  if (!validId(messageId)) throw new Error("Gmail message identifier was invalid.");
  const value = await gmailJson(
    `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=minimal`,
  );
  if (typeof value !== "object" || value === null) {
    throw new Error("Gmail message response was invalid.");
  }
  const item = value as { id?: unknown; threadId?: unknown; labelIds?: unknown };
  if (
    !validId(item.id) ||
    item.id !== messageId ||
    !validId(item.threadId) ||
    !Array.isArray(item.labelIds) ||
    !item.labelIds.every((label) => typeof label === "string" && label.length <= 255)
  ) {
    throw new Error("Gmail message summary was invalid.");
  }
  return { id: item.id, threadId: item.threadId, labelIds: item.labelIds };
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