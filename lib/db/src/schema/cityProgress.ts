import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const cityProgressTable = pgTable(
  "city_progress",
  {
    id: serial("id").primaryKey(),
    regionName: text("region_name").notNull(),
    cityName: text("city_name").notNull(),
    cityBudget: integer("city_budget").notNull().default(0),
    cityBudgetUsed: integer("city_budget_used").notNull().default(0),
  },
  (table) => [
    uniqueIndex("city_progress_region_city_unique").on(table.regionName, table.cityName),
    check("city_progress_budget_nonnegative", sql`${table.cityBudget} >= 0`),
    check("city_progress_budget_used_nonnegative", sql`${table.cityBudgetUsed} >= 0`),
  ],
);

export const insertCityProgressSchema = createInsertSchema(cityProgressTable).omit({ id: true });
export type InsertCityProgress = z.infer<typeof insertCityProgressSchema>;
export type CityProgress = typeof cityProgressTable.$inferSelect;