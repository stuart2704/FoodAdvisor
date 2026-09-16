import { db, restaurantsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

export async function markDoNotContact(placeId: string): Promise<boolean> {
  if (!placeId.trim() || placeId.length > 512) {
    throw new Error("A valid restaurant ID is required.");
  }
  const [updated] = await db
    .update(restaurantsTable)
    .set({
      suppressedAt: new Date(),
      suppressionReason: "lead_qualification_d",
      outreachStatus: "suppressed",
    })
    .where(
      and(
        eq(restaurantsTable.placeId, placeId.trim()),
        isNull(restaurantsTable.claimedAt),
      ),
    )
    .returning({ placeId: restaurantsTable.placeId });
  return updated !== undefined;
}

export default { markDoNotContact };