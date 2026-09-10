import { db, restaurantsTable, outreachAuditTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logEvent, logError } from "./eventsFeed";
import { classifyScraperError } from "../errors/errorService";

function count(value: unknown): number {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) {
    throw new Error("Invalid database count.");
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid database count.");
  return result;
}

/**
 * One read-only statement provides a consistent snapshot. Activity counts cover
 * UTC midnight through generatedAt; reply counts represent current state.
 * Counts can overlap across activity and state, so they must not be summed.
 */
export async function getDailyMetrics() {
  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const generatedAt = now.toISOString();
  const dayStart = start.toISOString();
  const active = sql`${restaurantsTable.suppressedAt} is null
    and ${restaurantsTable.outreachStatus} <> 'suppressed'`;
  const [row] = await db.select({
    total: sql<string>`count(*)`,
    inserted: sql<string>`count(*) filter (where
      ${restaurantsTable.importedAt} >= ${dayStart}::timestamptz
      and ${restaurantsTable.importedAt} <= ${generatedAt}::timestamptz)`,
    contacted: sql<string>`(select count(distinct ${outreachAuditTable.placeId})
      from ${outreachAuditTable} where ${outreachAuditTable.event} = 'sent'
      and ${outreachAuditTable.createdAt} >= ${dayStart}::timestamptz
      and ${outreachAuditTable.createdAt} <= ${generatedAt}::timestamptz)`,
    engaged: sql<string>`count(*) filter (where ${active}
      and ${restaurantsTable.outreachStatus} in ('interested', 'upgrade'))`,
    awaiting_followup: sql<string>`count(*) filter (where ${active}
      and ${restaurantsTable.outreachStatus} = 'question')`,
    closed: sql<string>`count(*) filter (where ${restaurantsTable.suppressedAt} is not null
      or ${restaurantsTable.outreachStatus} = 'suppressed')`,
    unknown_reply: sql<string>`count(*) filter (where ${active}
      and ${restaurantsTable.outreachStatus} = 'replied')`,
  }).from(restaurantsTable);
  if (!row) throw new Error("Metrics query returned no result.");
  return {
    generatedAt,
    dayStart,
    timezone: "UTC" as const,
    scraped: null,
    total: count(row.total),
    inserted: count(row.inserted),
    contacted: count(row.contacted),
    engaged: count(row.engaged),
    awaiting_followup: count(row.awaiting_followup),
    closed: count(row.closed),
    unknown_reply: count(row.unknown_reply),
  };
}

export async function generateDailySummary(): Promise<string> {
  logEvent("Generating daily summary");
  try {
    const stats = await getDailyMetrics();
    const summary = [
      "DAILY SUMMARY — The Food Advisor",
      "",
      `Activity today (UTC, since ${stats.dayStart}):`,
      "Scraped: not tracked separately; Maps imports are inserted directly",
      `Inserted: ${stats.inserted}`,
      `Contacted: ${stats.contacted} unique restaurants with confirmed sends`,
      "",
      "Current reply states (all stored restaurants):",
      `Engaged: ${stats.engaged}`,
      `Awaiting Follow-up: ${stats.awaiting_followup}`,
      `Closed / Suppressed: ${stats.closed}`,
      `Unknown Replies: ${stats.unknown_reply}`,
      "",
      `Total stored restaurants: ${stats.total}`,
      `Generated at: ${stats.generatedAt}`,
    ].join("\n");
    logEvent("Daily summary ready");
    return summary;
  } catch (err) {
    logError("Failed to generate daily summary", classifyScraperError(err));
    throw new Error("Daily summary could not be generated; database metrics are unavailable.");
  }
}