export type ScraperErrorCategory =
  | "timeout"
  | "network_error"
  | "validation_error"
  | "duplicate_error"
  | "not_found"
  | "permission_error"
  | "database_connection_error"
  | "general_error"
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

  if (message.includes("timeout")) return "timeout";
  if (message.includes("network")) return "network_error";
  if (message.includes("validation")) return "validation_error";
  if (message.includes("duplicate")) return "duplicate_error";
  if (message.includes("not found")) return "not_found";
  if (message.includes("permission")) return "permission_error";
  if (message.includes("connection")) return "database_connection_error";
  return "general_error";
}