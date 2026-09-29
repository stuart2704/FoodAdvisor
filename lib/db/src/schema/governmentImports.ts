import { boolean, date, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Configuration survives server restarts. An approval never implies that the
// billing gate has been met; the worker checks both at the time of each run.
export const governmentImportSourcesTable = pgTable("government_import_sources", {
  source: text("source").primaryKey(),
  approved: boolean("approved").notNull().default(false),
  paused: boolean("paused").notNull().default(true),
  cursor: text("cursor"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const governmentImportRunsTable = pgTable("government_import_runs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  runDay: date("run_day", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  scanned: integer("scanned").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [uniqueIndex("government_import_run_source_day_unique").on(table.source, table.runDay)]);

export const governmentImportDecisionsTable = pgTable("government_import_decisions", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});