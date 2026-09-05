import {
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const restaurantsTable = pgTable("restaurants", {
  placeId: text("place_id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  rating: real("rating"),
  website: text("website"),
  googleMapsUrl: text("google_maps_url").notNull(),
  types: text("types").array().notNull().default([]),
  importedAt: timestamp("imported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const restaurantImportRunsTable = pgTable("restaurant_import_runs", {
  id: serial("id").primaryKey(),
  cities: text("cities").array().notNull(),
  requested: integer("requested").notNull(),
  imported: integer("imported").notNull(),
  skippedDuplicates: integer("skipped_duplicates").notNull(),
  apiCalls: integer("api_calls").notNull(),
  estimatedCostCents: integer("estimated_cost_cents").notNull(),
  monthlyBudgetCents: integer("monthly_budget_cents").notNull(),
  stoppedBecause: text("stopped_because").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertRestaurantSchema = createInsertSchema(restaurantsTable);
export const insertRestaurantImportRunSchema = createInsertSchema(
  restaurantImportRunsTable,
).omit({ id: true, createdAt: true });

export type RestaurantRecord = typeof restaurantsTable.$inferSelect;
export type InsertRestaurant = typeof restaurantsTable.$inferInsert;
export type RestaurantImportRun =
  typeof restaurantImportRunsTable.$inferSelect;