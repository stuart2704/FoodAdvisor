import { logger } from "./logger";

export function logEvent(type: string, data: Record<string, unknown> = {}): void {
  logger.info({ ...data, timestamp: new Date().toISOString(), type }, "Grid crawl event");
}