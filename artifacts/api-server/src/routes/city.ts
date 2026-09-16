import { Router, type IRouter } from "express";
import { z } from "zod";
import { getCityPage } from "../services/cityPageEngine";
import { cityPageViewEventsTable, db } from "@workspace/db";

const router: IRouter = Router();

const CityParams = z.object({
  city: z.string().trim().min(1).max(100),
});

router.get("/city/:city", async (req, res) => {
  const parsed = CityParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid city." });
    return;
  }
  try {
    const data = await getCityPage(parsed.data.city);
    try {
      await db.insert(cityPageViewEventsTable).values({
        city: data.city,
        restaurantCount: data.restaurantCount,
      });
    } catch (error) {
      req.log.warn({ err: error }, "City page metric could not be recorded");
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ success: true, data });
  } catch (error) {
    req.log.error({ err: error }, "City page data query failed");
    res.status(503).json({
      success: false,
      error: "City recommendations are temporarily unavailable.",
    });
  }
});

export default router;