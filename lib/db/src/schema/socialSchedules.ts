import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const socialSchedulesTable = pgTable("social_schedules", {
  id: uuid("id").primaryKey(),
  restaurantId: uuid("restaurant_id"),
  platform: text("platform").notNull(),
  frequency: text("frequency").notNull(),
  timeOfDay: text("time_of_day").notNull(),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSocialScheduleSchema = createInsertSchema(socialSchedulesTable);
export type InsertSocialSchedule = typeof socialSchedulesTable.$inferInsert;
export type SocialSchedule = typeof socialSchedulesTable.$inferSelect;