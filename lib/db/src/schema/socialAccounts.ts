import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { restaurantsTable } from "./restaurants";

export const socialAccountsTable = pgTable("social_accounts", {
  id: uuid("id").primaryKey(),
  platform: text("platform").notNull(),
  pageId: text("page_id"),
  displayName: text("display_name"),
  /** Ciphertext; the legacy column name is retained for migration compatibility. */
  accessToken: text("access_token").notNull(),
  accessTokenIv: text("access_token_iv").notNull(),
  accessTokenTag: text("access_token_tag").notNull(),
  refreshToken: text("refresh_token"),
  restaurantId: text("restaurant_id").references(() => restaurantsTable.placeId),
  status: text("status").notNull().default("connected"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSocialAccountSchema = createInsertSchema(socialAccountsTable);
export type InsertSocialAccount = typeof socialAccountsTable.$inferInsert;
export type SocialAccount = typeof socialAccountsTable.$inferSelect;