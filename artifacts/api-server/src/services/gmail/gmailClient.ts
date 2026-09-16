import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  GmailHttpError,
  gmailThreadsPagePath,
  threadDiscoveryComplete,
} from "./gmailContracts";

export { GmailHttpError } from "./gmailContracts";

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

export async function sendGmailPlainText(input: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
}): Promise<{ id: string; threadId: string }> {
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to) ||
    input.to.length > 254 ||
    /[\r\n]/.test(input.to)
  ) {
    throw new Error("Gmail recipient is invalid.");
  }
  if (
    !input.subject.trim() ||
    input.subject.length > 160 ||
    /[\r\n\u0000-\u001f\u007f]/.test(input.subject)
  ) {
    throw new Error("Gmail subject is invalid.");
  }
  if (!input.body.trim() || input.body.length > 10_000) {
    throw new Error("Gmail body is invalid.");
  }
  if (
    input.threadId !== undefined &&
    (!validId(input.threadId) || /[\r\n]/.test(input.threadId))
  ) {
    throw new Error("Gmail thread is invalid.");
  }
  const profile = await getGmailProfile();
  const raw = Buffer.from(
    [
      `From: ${profile.emailAddress}`,
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.body.replace(/\r?\n/g, "\r\n"),
    ].join("\r\n"),
    "utf8",
  ).toString("base64url");
  const value = await gmailJson("/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: {
      raw,
      ...(input.threadId ? { threadId: input.threadId } : {}),
    },
  });
  const item =
    typeof value === "object" && value !== null
      ? (value as { id?: unknown; threadId?: unknown })
      : {};
  if (!validId(item.id) || !validId(item.threadId)) {
    throw new Error("Gmail send acknowledgement was invalid.");
  }
  return { id: item.id, threadId: item.threadId };
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
  messages: GmailMessageSummary[];
  historyId: string;
  nextPageToken?: string;
}

const HISTORY_PAGE_SIZE = 100;
export async function listGmailHistory(
  startHistoryId: string,
  pageToken?: string,
): Promise<GmailHistoryResult> {
  if (!validHistoryId(startHistoryId)) throw new Error("Gmail history cursor is invalid.");
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
  if (!validHistoryId(item.historyId) || (item.history !== undefined && !Array.isArray(item.history))) {
    throw new Error("Gmail history response was invalid.");
  }
  const messages: GmailMessageSummary[] = [];
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
      if (typeof message !== "object" || message === null) {
        throw new Error("Gmail history message was invalid.");
      }
      const item = message as { id?: unknown; threadId?: unknown; labelIds?: unknown };
      if (!validId(item.id) || !validId(item.threadId)) {
        throw new Error("Gmail history message was invalid.");
      }
      messages.push({
        id: item.id,
        threadId: item.threadId,
        labelIds: Array.isArray(item.labelIds)
          ? item.labelIds.filter((label): label is string => typeof label === "string")
          : [],
      });
    }
  }
  if (item.nextPageToken !== undefined && !validId(item.nextPageToken)) {
    throw new Error("Gmail history page token was invalid.");
  }
  return {
    messages,
    historyId: item.historyId,
    nextPageToken: item.nextPageToken,
  };
}

export const GMAIL_RECOVERY_MAX_PAGES = 100;

export async function searchInboxThreads(): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < GMAIL_RECOVERY_MAX_PAGES; page += 1) {
    const value = await gmailJson(gmailThreadsPagePath(GMAIL_REPLY_QUERY, pageToken));
    if (typeof value !== "object" || value === null) {
      throw new Error("Gmail thread search was invalid.");
    }
    const item = value as { threads?: unknown; nextPageToken?: unknown };
    if (item.threads !== undefined && !Array.isArray(item.threads)) {
      throw new Error("Gmail thread search was invalid.");
    }
    for (const thread of item.threads ?? []) {
      const id =
        typeof thread === "object" && thread !== null
          ? (thread as { id?: unknown }).id
          : undefined;
      if (!validId(id)) throw new Error("Gmail thread search was invalid.");
      ids.add(id);
    }
    if (item.nextPageToken === undefined) return [...ids];
    if (!validId(item.nextPageToken)) throw new Error("Gmail thread search was invalid.");
    pageToken = item.nextPageToken;
  }
  throw new Error("Gmail recovery search exceeded its page limit.");
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
  if (!threadDiscoveryComplete(messages.length)) {
    throw new Error("Gmail thread exceeded its safety limit.");
  }
  return messages.map((message) => {
    if (typeof message !== "object" || message === null) {
      throw new Error("Gmail thread message was invalid.");
    }
    const item = message as {
      id?: unknown;
      threadId?: unknown;
      labelIds?: unknown;
    };
    if (
      !validId(item.id) ||
      !validId(item.threadId) ||
      item.threadId !== threadId ||
      !Array.isArray(item.labelIds) ||
      !item.labelIds.every((label) => typeof label === "string" && label.length <= 255)
    ) {
      throw new Error("Gmail thread message was invalid.");
    }
    return {
      id: item.id,
      threadId: item.threadId,
      labelIds: item.labelIds,
    };
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