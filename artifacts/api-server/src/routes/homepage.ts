import { Router, type IRouter } from "express";
import { getHomepageData } from "../services/homepageEngine";
import { db, homepageViewEventsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/homepage", async (req, res) => {
  try {
    const data = await getHomepageData();
    try {
      await db.insert(homepageViewEventsTable).values({
        featuredCount: data.featured.length,
        trendingCount: data.trending.length,
        premiumCount: data.premium.length,
        discoveryCount: data.globalDiscovery.length,
      });
    } catch (error) {
      req.log.warn({ err: error }, "Homepage metric could not be recorded");
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ success: true, data });
  } catch (error) {
    req.log.error({ err: error }, "Homepage data query failed");
    res.status(503).json({
      success: false,
      error: "Homepage recommendations are temporarily unavailable.",
    });
  }
});

export default router;