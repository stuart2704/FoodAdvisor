import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
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
  },
  (table) => [
    check("crawler_progress_singleton", sql`${table.id} = 1`),
    check("crawler_progress_indices_nonnegative", sql`
      ${table.lastRegionIndex} >= 0 AND ${table.lastCityIndex} >= 0 AND ${table.lastPointIndex} >= 0
    `),
    check("crawler_progress_paid_requests_nonnegative", sql`${table.paidRequests} >= 0`),
  ],
);

export const insertCrawlerProgressSchema = createInsertSchema(crawlerProgressTable).omit({
  id: true,
  lastRun: true,
});
export type InsertCrawlerProgress = z.infer<typeof insertCrawlerProgressSchema>;
export type CrawlerProgress = typeof crawlerProgressTable.$inferSelect;