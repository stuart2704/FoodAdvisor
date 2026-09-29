import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const externalIngestionScheduleTable = pgTable("external_ingestion_schedule", {
  id: text("id").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastErrorSummary: text("last_error_summary"),
});

export const insertExternalIngestionScheduleSchema = createInsertSchema(externalIngestionScheduleTable);
export type InsertExternalIngestionSchedule = typeof externalIngestionScheduleTable.$inferInsert;
export type ExternalIngestionSchedule = typeof externalIngestionScheduleTable.$inferSelect;