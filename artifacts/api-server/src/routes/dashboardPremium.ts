import { db, restaurantsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";
import { listPaidCheckoutAlerts } from "../services/stripeCheckoutMonitor";

const router: IRouter = Router();

router.get("/premium/checkout-alerts", adminOnly, async (req, res) => {
  try {
    res.json({ success: true, items: await listPaidCheckoutAlerts() });
  } catch (error) {
    req.log.error({ err: error }, "Paid checkout alert query failed");
    res.status(503).json({ success: false, error: "Checkout alerts are unavailable." });
  }
});

router.get("/premium", adminOnly, async (req, res) => {
  try {
    const items = await db
      .select({
        placeId: restaurantsTable.placeId,
        name: restaurantsTable.name,
        city: restaurantsTable.city,
        premiumSince: restaurantsTable.premiumSince,
        stripeSubscriptionId: restaurantsTable.stripeSubscriptionId,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.premium, true))
      .orderBy(desc(restaurantsTable.premiumSince))
      .limit(250);
    res.json({ success: true, items });
  } catch (error) {
    req.log.error({ err: error }, "Premium client query failed");
    res.status(503).json({
      success: false,
      error: "Premium clients are temporarily unavailable.",
    });
  }
});

export default router;