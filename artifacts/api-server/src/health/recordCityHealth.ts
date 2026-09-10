import { recordScraperHealth } from "./scraperHealth";
import { classifyScraperError } from "../errors/errorService";
import { logEvent } from "../utils/eventLog";

/** Record observed outcomes only; collecting a sample never starts work. */
export function recordCityHealth(data: {
  city: string;
  confirmed: boolean;
  browser: boolean;
  startedAt: number;
  mapsSuccess: boolean;
  restaurants?: Array<{ enrichment: object }>;
  error?: unknown;
  unresolved?: number;
}): void {
  if (!data.confirmed) return;
  const attempted = (data.restaurants ?? []).map((row) => row.enrichment)
    .filter((result) => !("skipped" in result));
  const failures = attempted.filter((result) => "error" in result || ("ok" in result && result.ok === false));
  const errors = failures.map(() => "website_scrape_error");
  if (data.error !== undefined) errors.push(classifyScraperError(data.error));
  if (data.unresolved) errors.push("validation_error");
  try {
    recordScraperHealth({
      timestamp: new Date().toISOString(), city: data.city,
      mapsSuccess: data.mapsSuccess,
      websiteSuccess: attempted.length ? failures.length === 0 : null,
      // Individual proxy identity is intentionally not retained.
      proxyUsed: data.browser ? "unknown" : "none",
      durationMs: Math.max(0, Date.now() - data.startedAt), errors: errors.slice(0, 50),
    });
  } catch {
    // Diagnostics must not turn a completed import into a retryable failure.
    logEvent("warning", "City health sample could not be recorded");
  }
}