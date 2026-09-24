import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const regionProgressTable = pgTable(
  "region_progress",
  {
    regionName: text("region_name").primaryKey(),
    budgetMonth: date("budget_month", { mode: "string" }).notNull(),
    regionBudget: integer("region_budget").notNull().default(0),
    regionBudgetUsed: integer("region_budget_used").notNull().default(0),
    regionInterval: integer("region_interval").notNull().default(3),
    nextRegionRun: date("next_region_run", { mode: "string" }),
    lastRun: date("last_run", { mode: "string" }),
  },
  (table) => [
    check("region_progress_budget_nonnegative", sql`${table.regionBudget} >= 0`),
    check("region_progress_used_nonnegative", sql`${table.regionBudgetUsed} >= 0`),
    check("region_progress_interval_range", sql`${table.regionInterval} BETWEEN 1 AND 7`),
  ],
);

export const insertRegionProgressSchema = createInsertSchema(regionProgressTable);
export type InsertRegionProgress = z.infer<typeof insertRegionProgressSchema>;
export type RegionProgress = typeof regionProgressTable.$inferSelect;