import { getEvents } from "../utils/eventLog";

const categories = new Set([
  "unknown_error", "general_error", "timeout", "network_error", "validation_error",
  "duplicate_error", "not_found", "permission_error", "database_connection_error",
  "database_error", "db_error", "scraper_error", "outreach_error", "invalid_status",
  "maps_scrape_error", "website_scrape_error", "playwright_launch_error", "daily_cycle_error",
]);

/** Category counts from the current process's bounded buffer, not daily totals. */
export function getErrorSummary() {
  const errors = getEvents().filter((event) => event.type === "error");
  const byCategory: Record<string, number> = Object.create(null);
  for (const event of errors) {
    const category = event.category && categories.has(event.category) ? event.category : "unknown";
    byCategory[category] = (byCategory[category] ?? 0) + 1;
  }
  return byCategory;
}