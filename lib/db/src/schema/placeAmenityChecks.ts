import { check, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { restaurantImportRunsTable } from "./restaurants";

export const placeAmenityChecksTable = pgTable("place_amenity_checks", {
  id: serial("id").primaryKey(),
  placeId: text("place_id").notNull(),
  status: text("status").notNull(),
  mode: text("mode").notNull().default("initial"),
  source: text("source").notNull().default("google_place_details_new"),
  observedAmenities: text("observed_amenities").array(),
  baselineAmenities: text("baseline_amenities").array(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  reviewDecision: text("review_decision"),
  reservationId: integer("reservation_id").notNull().unique()
    .references(() => restaurantImportRunsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  check("place_amenity_checks_status_check", sql`${table.status} IN ('pending', 'completed', 'failed')`),
  check("place_amenity_checks_mode_check", sql`${table.mode} IN ('initial', 'refresh')`),
  check("place_amenity_checks_review_decision_check", sql`${table.reviewDecision} IS NULL OR ${table.reviewDecision} IN ('applied', 'rejected', 'conflict')`),
]);