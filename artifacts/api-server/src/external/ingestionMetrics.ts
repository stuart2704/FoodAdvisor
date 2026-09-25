import { db, externalCandidatesTable, restaurantsTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";

export async function getIngestionMetrics() {
  const [[total], [promotedRows], [restaurantRows]] = await Promise.all([
    db.select({ value: count() }).from(externalCandidatesTable),
    db.select({ value: count() }).from(externalCandidatesTable)
      .where(eq(externalCandidatesTable.verificationStatus, "promoted")),
    db.select({ value: count() }).from(restaurantsTable),
  ]);

  return {
    totalCandidates: total.value,
    promoted: promotedRows.value,
    restaurants: restaurantRows.value,
    // There is no outreachEligible field. The guarded sender applies further
    // consent, suppression, reply, history, and delivery checks at send time.
    eligible: null,
  };
}