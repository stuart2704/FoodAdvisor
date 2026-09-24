import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const socialPostsTable = pgTable("social_posts", {
  id: uuid("id").primaryKey(),
  restaurantId: uuid("restaurant_id"),
  platform: text("platform").notNull(),
  content: text("content").notNull(),
  mediaUrl: text("media_url"),
  status: text("status").notNull(),
  scheduledFor: timestamp("scheduled_for"),
  publishedAt: timestamp("published_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSocialPostSchema = createInsertSchema(socialPostsTable);
export type InsertSocialPost = typeof socialPostsTable.$inferInsert;
export type SocialPost = typeof socialPostsTable.$inferSelect;