import { Router, type IRouter } from "express";
import { z } from "zod";
import { getCuisinePage } from "../services/cuisinePageEngine";
import { cuisinePageViewEventsTable, db } from "@workspace/db";

const router: IRouter = Router();

const CuisineParams = z.object({
  cuisine: z.string().trim().min(1).max(100),
});

router.get("/cuisine/:cuisine", async (req, res) => {
  const parsed = CuisineParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid cuisine." });
    return;
  }
  try {
    const data = await getCuisinePage(parsed.data.cuisine);
    try {
      await db.insert(cuisinePageViewEventsTable).values({
        cuisine: data.cuisine,
        restaurantCount: data.restaurantCount,
      });
    } catch (error) {
      req.log.warn({ err: error }, "Cuisine page metric could not be recorded");
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ success: true, data });
  } catch (error) {
    req.log.error({ err: error }, "Cuisine page data query failed");
    res.status(503).json({
      success: false,
      error: "Cuisine recommendations are temporarily unavailable.",
    });
  }
});

export default router;