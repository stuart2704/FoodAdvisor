import { eq } from "drizzle-orm";
import { db, socialSettingsTable } from "@workspace/db";

export const SOCIAL_SETTINGS_ID = "00000000-0000-0000-0000-000000000000";

export async function getSocialSettings() {
  let [settings] = await db.select().from(socialSettingsTable)
    .where(eq(socialSettingsTable.id, SOCIAL_SETTINGS_ID)).limit(1);
  if (!settings) {
    // The additive migration seeds this row; this also safely initializes
    // databases where the schema was created through drizzle-kit push.
    await db.insert(socialSettingsTable)
      .values({ id: SOCIAL_SETTINGS_ID, automation: false })
      .onConflictDoNothing();
    [settings] = await db.select().from(socialSettingsTable)
      .where(eq(socialSettingsTable.id, SOCIAL_SETTINGS_ID)).limit(1);
  }
  if (!settings) throw new Error("Social automation settings could not be initialized.");
  return settings;
}