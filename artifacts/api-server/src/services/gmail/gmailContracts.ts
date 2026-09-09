export function gmailPushStatus(input: {
  authenticated: boolean;
  poison: boolean;
}): 204 | 401 | 503 {
  if (!input.authenticated) return 401;
  if (input.poison) return 204;
  return 503;
}

export function gmailNotificationStatus(input: {
  authenticated: boolean;
  poison: boolean;
  hasWatchState: boolean;
}): 204 | 401 | 503 {
  if (!input.authenticated) return 401;
  if (input.poison) return 204;
  if (!input.hasWatchState) return 503;
  return 503;
}

export function isPermanentGmailMessageStatus(status: number): boolean {
  return status === 400 || status === 404;
}

export class GmailHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Gmail connector request failed.");
    this.status = status;
  }
}

export type SummaryFetchFailureTransition =
  | {
      status: "skipped";
      tombstonedAt: Date;
      nextAttemptAt: null;
      backlog: false;
    }
  | {
      status: "pending";
      tombstonedAt: null;
      nextAttemptAt: Date;
      backlog: true;
    };

export function summaryFetchFailureTransition(
  error: unknown,
  now: Date,
): SummaryFetchFailureTransition {
  if (
    error instanceof GmailHttpError &&
    isPermanentGmailMessageStatus(error.status)
  ) {
    return {
      status: "skipped",
      tombstonedAt: now,
      nextAttemptAt: null,
      backlog: false,
    };
  }
  return {
    status: "pending",
    tombstonedAt: null,
    nextAttemptAt: new Date(now.getTime() + 30_000),
    backlog: true,
  };
}

export const GMAIL_THREAD_MESSAGE_LIMIT = 5_000;

export function threadDiscoveryComplete(messageCount: number): boolean {
  return Number.isInteger(messageCount) && messageCount <= GMAIL_THREAD_MESSAGE_LIMIT;
}

export function completedRecoveryState<T extends object>(watch: T): T & {
  historyScanStartId: null;
  historyPageToken: null;
} {
  return { ...watch, historyScanStartId: null, historyPageToken: null };
}

export function historyDeliveryStatus(input: {
  complete: boolean;
  failed: boolean;
  capped: boolean;
}): 204 | 503 {
  return input.complete && !input.failed && !input.capped ? 204 : 503;
}

export function gmailThreadsPagePath(query: string, pageToken?: string): string {
  const params = new URLSearchParams({ q: query, maxResults: "50" });
  if (pageToken) params.set("pageToken", pageToken);
  return `/gmail/v1/users/me/threads?${params.toString()}`;
}