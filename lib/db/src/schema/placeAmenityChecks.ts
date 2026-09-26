import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { restaurantImportRunsTable } from "./restaurants";

export const placeAmenityChecksTable = pgTable("place_amenity_checks", {
  placeId: text("place_id").primaryKey(),
  status: text("status").notNull(),
  reservationId: integer("reservation_id").notNull().unique()
    .references(() => restaurantImportRunsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  check("place_amenity_checks_status_check", sql`${table.status} IN ('pending', 'completed', 'failed')`),
]);