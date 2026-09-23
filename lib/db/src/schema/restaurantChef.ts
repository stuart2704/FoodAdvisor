import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { restaurantsTable } from "./restaurants";

export const restaurantChefProfilesTable = pgTable(
  "restaurant_chef_profiles",
  {
    restaurantId: text("restaurant_id")
      .primaryKey()
      .references(() => restaurantsTable.placeId, { onDelete: "cascade" }),
    name: text("name"),
    bio: text("bio"),
    philosophy: text("philosophy"),
    awards: text("awards").array().notNull().default([]),
    awardEvidenceUrls: text("award_evidence_urls").array().notNull().default([]),
    signatureDishes: text("signature_dishes").array().notNull().default([]),
    dishEvidenceUrls: text("dish_evidence_urls").array().notNull().default([]),
    photoObjectPath: text("photo_object_path"),
    photoMimeType: text("photo_mime_type"),
    photoSizeBytes: integer("photo_size_bytes"),
    moderationStatus: text("moderation_status").notNull().default("pending"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    rejectionReason: text("rejection_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("restaurant_chef_profiles_status_idx").on(table.moderationStatus),
  ],
);

export const insertRestaurantChefProfileSchema = createInsertSchema(
  restaurantChefProfilesTable,
).omit({ createdAt: true, updatedAt: true });

export type RestaurantChefProfile = typeof restaurantChefProfilesTable.$inferSelect;
export type InsertRestaurantChefProfile =
  typeof restaurantChefProfilesTable.$inferInsert;