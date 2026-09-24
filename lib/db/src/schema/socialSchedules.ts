import { boolean, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";
import { createInsertSchema } from "drizzle-zod";

export const socialSchedulesTable = pgTable("social_schedules", {
  id: uuid("id").primaryKey(),
  restaurantId: text("restaurant_id").references(() => restaurantsTable.placeId),
  platform: text("platform").notNull(),
  frequency: text("frequency").notNull(),
  timeOfDay: text("time_of_day").notNull(),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({ assignmentUnique: uniqueIndex("social_schedule_assignment_unique").on(table.restaurantId, table.platform, table.frequency, table.timeOfDay) }));

export const insertSocialScheduleSchema = createInsertSchema(socialSchedulesTable);
export type InsertSocialSchedule = typeof socialSchedulesTable.$inferInsert;
export type SocialSchedule = typeof socialSchedulesTable.$inferSelect;