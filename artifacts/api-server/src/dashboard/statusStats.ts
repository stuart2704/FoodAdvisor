import { db, restaurantsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logError } from "./eventsFeed";

export interface StatusCount { status: string; count: number }

/** Read-only aggregation over the real outreach fields, using the shared pool. */
export async function getStatusCounts(): Promise<StatusCount[]> {
  const status = sql<string>`case
    when ${restaurantsTable.suppressedAt} is not null or ${restaurantsTable.outreachStatus} = 'suppressed' then 'closed'
    when ${restaurantsTable.outreachStatus} = 'pending' then 'not_contacted'
    when ${restaurantsTable.outreachStatus} = 'sent' then 'contacted'
    when ${restaurantsTable.outreachStatus} = 'followup_sent' then 'followup_sent'
    when ${restaurantsTable.outreachStatus} = 'final_followup_sent' then 'final_followup_sent'
    when ${restaurantsTable.outreachStatus} in ('interested', 'upgrade') then 'engaged'
    when ${restaurantsTable.outreachStatus} = 'question' then 'awaiting_followup'
    when ${restaurantsTable.outreachStatus} = 'replied' then 'unknown_reply'
    when ${restaurantsTable.outreachStatus} = 'send_failed' then 'error'
    when ${restaurantsTable.outreachStatus} = 'sending' then 'sending'
    when ${restaurantsTable.outreachStatus} = 'out_of_office' then 'out_of_office'
    else 'unmapped' end`;
  try {
    const rows = await db.select({ status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(restaurantsTable).groupBy(status).orderBy(status);
    if (rows.some((row) => !Number.isSafeInteger(row.count) || row.count < 0)) {
      throw new Error("Invalid aggregate.");
    }
    return rows;
  } catch {
    logError("Dashboard status counts could not be read", "database_error");
    throw new Error("Dashboard status counts are unavailable.");
  }
}