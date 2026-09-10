import {
  db,
  instantlyCampaignCancellationTable,
  instantlyFollowupCampaignsTable,
  instantlyOutreachCampaignsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Must be called in the same transaction as the local stop-state update. */
export async function enqueueAllInstantlyCancellationIntents(
  tx: DatabaseTransaction,
  placeId: string,
): Promise<void> {
  const [initial, followups] = await Promise.all([
    tx.select({ campaignId: instantlyOutreachCampaignsTable.campaignId })
      .from(instantlyOutreachCampaignsTable)
      .where(eq(instantlyOutreachCampaignsTable.placeId, placeId)),
    tx.select({ campaignId: instantlyFollowupCampaignsTable.campaignId })
      .from(instantlyFollowupCampaignsTable)
      .where(eq(instantlyFollowupCampaignsTable.placeId, placeId)),
  ]);
  for (const row of [...initial, ...followups]) {
    await tx.insert(instantlyCampaignCancellationTable).values({
      campaignId: row.campaignId,
      placeId,
    }).onConflictDoNothing();
  }
}