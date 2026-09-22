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

export type OperationalErrorCategory =
  | "timeout"
  | "network_error"
  | "auth_error"
  | "db_error"
  | "validation_error"
  | "rate_limit"
  | "unknown_error";

export interface OperationalErrorLog {
  summary?: unknown;
  message?: unknown;
}

export function classifyError(
  log: OperationalErrorLog,
): OperationalErrorCategory {
  const detail =
    typeof log.summary === "string"
      ? log.summary
      : typeof log.message === "string"
        ? log.message
        : "";
  const summary = detail.toLowerCase();

  if (summary.includes("timeout")) return "timeout";
  if (summary.includes("network")) return "network_error";
  if (summary.includes("auth")) return "auth_error";
  if (summary.includes("permission")) return "auth_error";
  if (summary.includes("db") || summary.includes("database")) return "db_error";
  if (summary.includes("validation")) return "validation_error";
  if (summary.includes("rate")) return "rate_limit";

  return "unknown_error";
}

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