import { db, restaurantsTable } from "@workspace/db";
import { desc, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.get("/escalation", adminOnly, async (req, res) => {
  try {
    const items = await db
      .select({
        placeId: restaurantsTable.placeId,
        restaurant: restaurantsTable.name,
        leadStatus: restaurantsTable.leadStatus,
        escalatedAt: restaurantsTable.escalatedAt,
        claimClickedAt: restaurantsTable.claimClickedAt,
        onboardedAt: restaurantsTable.onboardedAt,
        onboardingStatus: restaurantsTable.onboardingStatus,
      })
      .from(restaurantsTable)
      .where(inArray(restaurantsTable.leadStatus, ["HOT", "WARM", "CLIENT"]))
      .orderBy(desc(restaurantsTable.escalatedAt))
      .limit(50);
    res.json({
      success: true,
      items: items.map((item) => ({ ...item, lastReply: null })),
      replyStorage: "body_free",
    });
  } catch (error) {
    req.log.error({ err: error }, "Lead escalation dashboard query failed");
    res.status(500).json({
      success: false,
      error: "Lead escalation activity is unavailable.",
    });
  }
});

export default router;