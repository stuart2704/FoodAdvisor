import { db, restaurantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logEvent } from "../utils/eventLog";
import { parseRestaurant } from "./validator";
import { getRegionForCity } from "../services/regionMap";
import { restaurantSlug } from "../utils/slugify";

export type InsertedRestaurant = typeof restaurantsTable.$inferSelect;

// Reuse the shared Neon connection and TLS settings; never create another pool.
export async function dbInsertRestaurant(input: unknown): Promise<InsertedRestaurant | null> {
  const restaurant = parseRestaurant(input);
  const region = getRegionForCity(restaurant.city);
  try {
    const [inserted] = await db.insert(restaurantsTable)
      .values({
        ...restaurant,
        ...(region ?? {}),
        slug: restaurantSlug(restaurant.name, restaurant.placeId),
      })
      .onConflictDoNothing({ target: restaurantsTable.placeId })
      .returning();
    logEvent(inserted ? "success" : "info",
      inserted ? "Restaurant inserted into Neon" : "Duplicate restaurant skipped");
    return inserted ?? null;
  } catch {
    logEvent("error", "Restaurant insertion failed");
    throw new Error("Restaurant insertion failed; retry is required.");
  }
}

// Informational only: the atomic insert above remains the final duplicate guard.
export async function isDuplicate(input: unknown): Promise<boolean> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("A Google Place ID is required for duplicate checks.");
  }
  const restaurant = input as Record<string, unknown>;
  const placeId = restaurant.placeId ?? restaurant.id;
  if (typeof placeId !== "string" || !placeId.trim() || placeId.trim().length > 512) {
    throw new Error("A valid Google Place ID is required for duplicate checks.");
  }
  try {
    const rows = await db.select({ placeId: restaurantsTable.placeId })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, placeId.trim()))
      .limit(1);
    return rows.length > 0;
  } catch {
    logEvent("error", "Restaurant duplicate check failed");
    throw new Error("Duplicate status is unavailable; retry the database check.");
  }
}