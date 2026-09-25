import { logger } from "../lib/logger";

// Process-local operational flag only; not a durable failure circuit breaker.
const suppressedSources = new Set<string>();

export function suppressSource(name: string): void {
  suppressedSources.add(name);
  logger.warn({ source: name }, "Source suppressed in this process");
}

export function isSuppressed(name: string): boolean {
  return suppressedSources.has(name);
}

export function listSuppressedSources(): string[] {
  return [...suppressedSources];
}