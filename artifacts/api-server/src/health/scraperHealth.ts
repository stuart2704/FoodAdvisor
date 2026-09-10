import { logEvent } from "../dashboard/eventsFeed";
import { classifyScraperError } from "../errors/errorService";
import { SUPPORTED_CITIES } from "../lib/restaurant-import";

export interface HealthRecord {
  timestamp: string;
  city: string;
  mapsSuccess: boolean;
  /** null means website extraction was not attempted. */
  websiteSuccess: boolean | null;
  proxyUsed: string;
  durationMs: number;
  errors: string[];
}

export const HEALTH_HISTORY_CAPACITY = 500;
// Diagnostic history only: process-local, bounded, and cleared on restart.
const healthLog: HealthRecord[] = [];
const proxyLabels = new Set(["none", "residential", "datacenter", "mixed", "unknown"]);
const errorLabels = new Set([
  "unknown_error", "general_error", "timeout", "network_error", "validation_error",
  "duplicate_error", "not_found", "permission_error", "database_connection_error",
  "maps_scrape_error", "website_scrape_error", "playwright_launch_error",
]);
const copy = (record: HealthRecord): HealthRecord => ({ ...record, errors: [...record.errors] });

export function recordScraperHealth(data: HealthRecord): void {
  const date = new Date(data.timestamp);
  const city = typeof data.city === "string"
    ? SUPPORTED_CITIES.find((item) => item.toLowerCase() === data.city.trim().toLowerCase()) : undefined;
  if (!Number.isFinite(date.getTime()) || !city || typeof data.mapsSuccess !== "boolean"
    || (data.websiteSuccess !== null && typeof data.websiteSuccess !== "boolean")
    || !Number.isFinite(data.durationMs) || data.durationMs < 0
    || !Array.isArray(data.errors) || data.errors.length > 50) {
    throw new Error("Invalid scraper health record.");
  }
  const errors = data.errors.map((error) => {
    if (typeof error !== "string") return "unknown_error";
    return errorLabels.has(error) ? error : classifyScraperError(error.slice(0, 4096));
  });
  healthLog.push({
    timestamp: date.toISOString(), city, mapsSuccess: data.mapsSuccess,
    websiteSuccess: data.websiteSuccess, durationMs: data.durationMs,
    proxyUsed: proxyLabels.has(data.proxyUsed) ? data.proxyUsed : "redacted",
    errors,
  });
  if (healthLog.length > HEALTH_HISTORY_CAPACITY) healthLog.shift();
  logEvent("Scraper health recorded");
}

export function getRecentHealth(limit = 20): HealthRecord[] {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > HEALTH_HISTORY_CAPACITY) {
    throw new Error("Health history limit must be an integer from 0 to 500.");
  }
  return limit === 0 ? [] : healthLog.slice(-limit).map(copy);
}

/** Last ten samples from today (UTC), not a fabricated perfect score on startup. */
export function computeDailyHealthScore(): number | null {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const recent = healthLog.filter((record) =>
    record.timestamp.startsWith(today) && new Date(record.timestamp).getTime() <= now).slice(-10);
  if (recent.length === 0) return null;
  const penalty = recent.reduce((total, record) => total
    + record.errors.length * 5
    + (record.durationMs > 20000 ? 3 : 0)
    + (record.mapsSuccess ? 0 : 4)
    + (record.websiteSuccess === false ? 2 : 0), 0);
  return Math.max(0, 100 - penalty);
}