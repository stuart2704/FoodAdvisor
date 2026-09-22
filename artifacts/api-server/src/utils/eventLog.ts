import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";
import {
  persistOperationalEvent,
  sanitizeOperationalEvent,
  type SanitizedOperationalEvent,
} from "../services/operationalLog";

export interface LogEvent {
  id: string;
  time: string;
  type: string;
  message: string;
  category?: string;
  bookmarked: boolean;
  tags: string[];
}

// Process-local diagnostics only: do not include credentials or message bodies.
const events: LogEvent[] = [];

export function logEvent(
  type: string,
  message: string,
  category?: string,
  tags: string[] = [],
): void {
  const sanitized = sanitizeOperationalEvent(type, message, category);
  const sanitizedTags = [
    ...new Set(
      tags
        .map((tag) =>
          tag
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "_")
            .slice(0, 32),
        )
        .filter(Boolean),
    ),
  ].slice(0, 10);
  const event: SanitizedOperationalEvent = {
    id: randomUUID(),
    time: new Date().toISOString(),
    ...sanitized,
    bookmarked: false,
    tags: sanitizedTags,
  };
  events.push(event);

  if (events.length > 200) events.shift();
  void persistOperationalEvent(event).catch((error) => {
    logger.warn({ err: error }, "Operational event persistence failed.");
  });
}

export function getEvents(): LogEvent[] {
  // Readers must not be able to mutate the stored log.
  return events.map((event) => ({ ...event, tags: [...event.tags] }));
}