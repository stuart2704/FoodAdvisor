import { db, ownerOfferMetricsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

export type OwnerOfferOutcome =
  | "owner_offer_published"
  | "owner_offer_updated"
  | "owner_offer_deleted";

/** Global daily counts only: no restaurant IDs, offer details, browser URLs, or tokens. */
export async function recordOwnerOfferOutcome(event: OwnerOfferOutcome): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await db.insert(ownerOfferMetricsTable)
    .values({ day, event, count: 1 })
    .onConflictDoUpdate({
      target: [ownerOfferMetricsTable.day, ownerOfferMetricsTable.event],
      set: { count: sql`${ownerOfferMetricsTable.count} + 1` },
    });
}