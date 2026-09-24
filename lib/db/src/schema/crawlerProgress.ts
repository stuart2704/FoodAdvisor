import { sql } from "drizzle-orm";
import { boolean, check, date, integer, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const crawlerProgressTable = pgTable(
  "crawler_progress",
  {
    id: serial("id").primaryKey(),
    lastRegionIndex: integer("last_region_index").notNull().default(0),
    lastCityIndex: integer("last_city_index").notNull().default(0),
    lastPointIndex: integer("last_point_index").notNull().default(0),
    lastRun: timestamp("last_run", { withTimezone: true }).notNull().defaultNow(),
    paidRequests: integer("paid_requests").notNull().default(0),
    paidRequestsToday: integer("paid_requests_today").notNull().default(0),
    paidRequestsMonth: integer("paid_requests_month").notNull().default(0),
    paidRequestsLastPoint: integer("paid_requests_last_point").notNull().default(0),
    lastPaidReset: date("last_paid_reset", { mode: "string" })
      .notNull()
      .default(sql`(timezone('UTC', now())::date)`),
    cycleNumber: integer("cycle_number").notNull().default(1),
    cycleCompleted: boolean("cycle_completed").notNull().default(false),
    nextRegionRun: date("next_region_run", { mode: "string" }),
    regionInterval: integer("region_interval").notNull().default(3),
    regionBudget: integer("region_budget").notNull().default(0),
    regionBudgetUsed: integer("region_budget_used").notNull().default(0),
  },
  (table) => [
    check("crawler_progress_singleton", sql`${table.id} = 1`),
    check("crawler_progress_indices_nonnegative", sql`
      ${table.lastRegionIndex} >= 0 AND ${table.lastCityIndex} >= 0 AND ${table.lastPointIndex} >= 0
    `),
    check("crawler_progress_paid_requests_nonnegative", sql`${table.paidRequests} >= 0`),
    check("crawler_progress_paid_requests_today_nonnegative", sql`${table.paidRequestsToday} >= 0`),
    check("crawler_progress_paid_requests_month_nonnegative", sql`${table.paidRequestsMonth} >= 0`),
    check("crawler_progress_paid_requests_last_point_nonnegative", sql`${table.paidRequestsLastPoint} >= 0`),
    check("crawler_progress_cycle_number_positive", sql`${table.cycleNumber} >= 1`),
    check("crawler_progress_region_interval_range", sql`${table.regionInterval} BETWEEN 1 AND 7`),
    check("crawler_progress_region_budget_nonnegative", sql`${table.regionBudget} >= 0`),
    check("crawler_progress_region_budget_used_nonnegative", sql`${table.regionBudgetUsed} >= 0`),
  ],
);

export const insertCrawlerProgressSchema = createInsertSchema(crawlerProgressTable).omit({
  id: true,
  lastRun: true,
});
export type InsertCrawlerProgress = z.infer<typeof insertCrawlerProgressSchema>;
export type CrawlerProgress = typeof crawlerProgressTable.$inferSelect;