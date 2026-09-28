import { pgTable, text, timestamp, uuid, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { createInsertSchema } from "drizzle-zod";

export const socialPostsTable = pgTable("social_posts", {
  id: uuid("id").primaryKey(),
  restaurantId: text("restaurant_id").references(() => restaurantsTable.placeId),
  platform: text("platform").notNull(),
  accountId: uuid("account_id"),
  content: text("content").notNull(),
  mediaUrl: text("media_url"),
  mediaObjectPath: text("media_object_path"),
  mediaApprovedAt: timestamp("media_approved_at", { withTimezone: true }),
  privacyLevel: text("privacy_level"),
  status: text("status").notNull(),
  scheduledFor: timestamp("scheduled_for"),
  publishedAt: timestamp("published_at"),
  errorMessage: text("error_message"),
  attemptCount: integer("attempt_count").notNull().default(0),
  providerPostId: text("provider_post_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ idempotencyUnique: uniqueIndex("social_posts_idempotency_key_unique").on(table.idempotencyKey) }));

export const insertSocialPostSchema = createInsertSchema(socialPostsTable);
export type InsertSocialPost = typeof socialPostsTable.$inferInsert;
export type SocialPost = typeof socialPostsTable.$inferSelect;