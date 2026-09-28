import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";

export const restaurantPhotosTable = pgTable("restaurant_photos", {
  id: uuid("id").defaultRandom().primaryKey(),
  restaurantId: text("restaurant_id").notNull().references(() => restaurantsTable.placeId, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull().unique(),
  generation: text("generation").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("restaurant_photos_public_idx").on(table.restaurantId, table.status)]);

export const restaurantPhotoIntentsTable = pgTable("restaurant_photo_intents", {
  id: uuid("id").defaultRandom().primaryKey(),
  restaurantId: text("restaurant_id").notNull().references(() => restaurantsTable.placeId, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull().unique(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  cleanupAfter: timestamp("cleanup_after", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("restaurant_photo_intents_cleanup_idx").on(table.cleanupAfter)]);

export const restaurantPhotoDeletionQueueTable = pgTable("restaurant_photo_deletion_queue", {
  objectPath: text("object_path").primaryKey(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("restaurant_photo_deletion_due_idx").on(table.dueAt)]);