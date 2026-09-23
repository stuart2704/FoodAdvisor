import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";

export const chefPhotoUploadIntentsTable = pgTable(
  "chef_photo_upload_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    objectPath: text("object_path").notNull().unique(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurantsTable.placeId, { onDelete: "cascade" }),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chef_photo_upload_intents_owner_active_idx").on(table.restaurantId, table.expiresAt, table.consumedAt),
    index("chef_photo_upload_intents_expires_idx").on(table.expiresAt),
  ],
);