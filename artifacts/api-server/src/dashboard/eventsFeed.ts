import { logEvent as recordEvent, getEvents as readEvents } from "../utils/eventLog";
import { logger } from "../lib/logger";

export interface EventItem {
  type: "event" | "error";
  message: string;
  category?: string;
  timestamp: string;
}

// Shared bounded store, not a second queue. Pass fixed operational messages:
// never include credentials, raw provider errors, URLs, or email bodies.
export function logEvent(message: string): void {
  recordEvent("info", message);
  logger.info({ source: "events-feed" }, message);
}

export function logError(message: string, category: string = "unknown"): void {
  const safeCategory = typeof category === "string" && /^[a-z][a-z0-9_-]{0,63}$/i.test(category)
    ? category : "unknown";
  recordEvent("error", message, safeCategory);
  logger.error({ source: "events-feed", category: safeCategory }, message);
}

export function getEvents(): EventItem[] {
  return readEvents().map((event) => ({
    type: event.type === "error" ? "error" : "event",
    message: event.message,
    timestamp: event.time,
    ...(event.category ? { category: event.category } : {}),
  }));
}

/** Raw events for dashboard consumers; preserves time/type/message fields. */
export function getRecentEvents() {
  return readEvents();
}