import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const socialAccountsTable = pgTable("social_accounts", {
  id: uuid("id").primaryKey(),
  platform: text("platform").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  restaurantId: uuid("restaurant_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSocialAccountSchema = createInsertSchema(socialAccountsTable);
export type InsertSocialAccount = typeof socialAccountsTable.$inferInsert;
export type SocialAccount = typeof socialAccountsTable.$inferSelect;