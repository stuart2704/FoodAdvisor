import { date, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ownerOfferMetricsTable = pgTable("owner_offer_metrics", {
  day: date("day", { mode: "string" }).notNull(),
  event: text("event").notNull(),
  count: integer("count").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.day, table.event] })]);

export const insertOwnerOfferMetricSchema = createInsertSchema(ownerOfferMetricsTable);
export type OwnerOfferMetric = typeof ownerOfferMetricsTable.$inferSelect;
export type InsertOwnerOfferMetric = z.infer<typeof insertOwnerOfferMetricSchema>;