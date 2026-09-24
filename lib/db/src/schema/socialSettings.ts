import { boolean, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const socialSettingsTable = pgTable("social_settings", {
  id: uuid("id").primaryKey(),
  automation: boolean("automation").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSocialSettingsSchema = createInsertSchema(socialSettingsTable);
export type InsertSocialSettings = typeof socialSettingsTable.$inferInsert;
export type SocialSettings = typeof socialSettingsTable.$inferSelect;