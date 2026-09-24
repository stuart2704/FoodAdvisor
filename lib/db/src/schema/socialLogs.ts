import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { restaurantsTable } from "./restaurants";

export const socialLogsTable = pgTable("social_logs", {
  id: uuid("id").primaryKey(),
  postId: uuid("post_id"),
  accountId: uuid("account_id"),
  restaurantId: text("restaurant_id").references(() => restaurantsTable.placeId),
  platform: text("platform").notNull(),
  event: text("event").notNull(),
  status: text("status").notNull(),
  message: text("message"),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertSocialLogSchema = createInsertSchema(socialLogsTable);
export type SocialLog = typeof socialLogsTable.$inferSelect;