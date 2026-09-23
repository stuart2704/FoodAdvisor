import { bigint, check, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scraperProxyBudget = pgTable("scraper_proxy_budget", {
  id: integer("id").primaryKey(),
  capMicros: bigint("cap_micros", { mode: "number" }).notNull(),
  reservedMicros: bigint("reserved_micros", { mode: "number" }).notNull().default(0),
}, (table) => [
  check("scraper_proxy_budget_singleton", sql`${table.id} = 1`),
  check("scraper_proxy_budget_positive_cap", sql`${table.capMicros} > 0`),
  check("scraper_proxy_budget_within_cap", sql`${table.reservedMicros} >= 0 AND ${table.reservedMicros} <= ${table.capMicros}`),
]);
export const scraperProxyReservations = pgTable("scraper_proxy_reservations", {
  id: uuid("id").primaryKey(),
  scanType: text("scan_type").notNull(),
  amountMicros: bigint("amount_micros", { mode: "number" }).notNull(),
  pricing: jsonb("pricing").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("scraper_proxy_reservations_type", sql`${table.scanType} IN ('maps', 'website')`),
  check("scraper_proxy_reservations_positive_amount", sql`${table.amountMicros} > 0`),
]);
export const insertScraperProxyBudgetSchema = createInsertSchema(scraperProxyBudget);
export const insertScraperProxyReservationSchema = createInsertSchema(scraperProxyReservations).omit({ createdAt: true });
export type InsertScraperProxyBudget = z.infer<typeof insertScraperProxyBudgetSchema>;
export type InsertScraperProxyReservation = z.infer<typeof insertScraperProxyReservationSchema>;
export type ScraperProxyBudget = typeof scraperProxyBudget.$inferSelect;
export type ScraperProxyReservation = typeof scraperProxyReservations.$inferSelect;