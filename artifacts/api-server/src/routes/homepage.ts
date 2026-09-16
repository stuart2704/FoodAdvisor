import { Router, type IRouter } from "express";
import { getHomepageData } from "../services/homepageEngine";
import { db, homepageViewEventsTable } from "@workspace/db";
import {
  getVisitorProfile,
  personaliseHomepage,
} from "../services/personalisationEngine";

const router: IRouter = Router();

router.get("/homepage", async (req, res) => {
  try {
    const baseData = await getHomepageData();
    const visitorId = req.get("X-Visitor-Id");
    let data = baseData;
    if (visitorId) {
      try {
        const profile = await getVisitorProfile(visitorId);
        if (profile) data = personaliseHomepage(baseData, profile);
      } catch {
        res.status(400).json({
          success: false,
          error: "The visitor profile identifier is invalid.",
        });
        return;
      }
    }
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
    res.setHeader("Vary", "X-Visitor-Id");
    res.setHeader(
      "Cache-Control",
      visitorId ? "private, no-store" : "public, max-age=300",
    );
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