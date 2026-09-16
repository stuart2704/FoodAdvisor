import {
  db,
  instantlyFollowupCampaignsTable,
  instantlySentMessagesTable,
  restaurantsTable,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.get("/followups", adminOnly, async (req, res) => {
  try {
    const items = await db
      .select({
        restaurant: restaurantsTable.name,
        placeId: restaurantsTable.placeId,
        attempt: instantlySentMessagesTable.emailNumber,
        subject: instantlyFollowupCampaignsTable.subject,
        sentAt: instantlySentMessagesTable.sentAt,
      })
      .from(instantlySentMessagesTable)
      .innerJoin(
        instantlyFollowupCampaignsTable,
        eq(
          instantlySentMessagesTable.campaignId,
          instantlyFollowupCampaignsTable.campaignId,
        ),
      )
      .innerJoin(
        restaurantsTable,
        eq(instantlySentMessagesTable.placeId, restaurantsTable.placeId),
      )
      .orderBy(desc(instantlySentMessagesTable.sentAt))
      .limit(50);
    res.json({ success: true, items });
  } catch (error) {
    req.log.error({ err: error }, "Follow-up dashboard query failed");
    res.status(500).json({
      success: false,
      error: "Follow-up activity is unavailable.",
    });
  }
});

export default router;