import { db, restaurantsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { generateLoginToken } from "./portalTokenService";

export async function startOnboarding(placeId: string) {
  if (!placeId.trim() || placeId.length > 512) {
    throw new Error("A valid restaurant ID is required.");
  }
  const [updated] = await db
    .update(restaurantsTable)
    .set({
      leadStatus: "CLIENT",
      onboardedAt: sql`coalesce(${restaurantsTable.onboardedAt}, now())`,
      onboardingStatus: "READY",
    })
    .where(eq(restaurantsTable.placeId, placeId.trim()))
    .returning({
      placeId: restaurantsTable.placeId,
      onboardingStatus: restaurantsTable.onboardingStatus,
      onboardedAt: restaurantsTable.onboardedAt,
    });
  if (!updated) throw new Error("Restaurant not found.");
  const portalToken = await generateLoginToken(updated.placeId);
  return { ...updated, portalToken };
}

export default { startOnboarding };