export type ScraperErrorCategory =
  | "network_error"
  | "scraper_error"
  | "db_error"
  | "validation_error"
  | "outreach_error"
  | "unknown_error";

/**
 * Diagnostic labels only, not a retry policy. Existing structured provider
 * error handling remains authoritative for retries and permanent failures.
 * Error contents are inspected locally but never logged or returned.
 */
export function classifyScraperError(err: unknown): ScraperErrorCategory {
  if (!err) return "unknown_error";

  let message: string;
  try {
    const detail = typeof err === "object" && err !== null && "message" in err
      ? err.message : err;
    message = typeof detail === "string" ? detail.toLowerCase() : "";
  } catch {
    // Even malformed error objects must not break error handling.
    return "unknown_error";
  }

  if (["fetch", "network", "timeout", "connection"].some((word) => message.includes(word))) {
    return "network_error";
  }
  if (["scrape", "selector", "playwright", "cheerio"].some((word) => message.includes(word))) {
    return "scraper_error";
  }
  if (["neon", "postgres", "sql", "db"].some((word) => message.includes(word))) {
    return "db_error";
  }
  if (["validation", "invalid", "missing"].some((word) => message.includes(word))) {
    return "validation_error";
  }
  if (["email", "send", "smtp"].some((word) => message.includes(word))) {
    return "outreach_error";
  }
  return "unknown_error";
}