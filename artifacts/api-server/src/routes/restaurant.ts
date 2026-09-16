import { Router, type IRouter } from "express";
import { z } from "zod";
import { getRestaurantProfile } from "../services/restaurantProfileEngine";
import { db, restaurantProfileViewEventsTable } from "@workspace/db";
import { logEvent } from "../services/analyticsEngine";

const router: IRouter = Router();

const RestaurantParams = z.object({
  id: z.string().trim().min(1).max(512),
});

router.get("/restaurant/:id", async (req, res) => {
  const parsed = RestaurantParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid restaurant ID." });
    return;
  }
  try {
    const data = await getRestaurantProfile(parsed.data.id);
    if (!data) {
      res.status(404).json({ success: false, error: "Restaurant not found." });
      return;
    }
    try {
      await db.insert(restaurantProfileViewEventsTable).values({
        placeId: data.id,
        premium: data.premium,
        claimed: data.claimed,
      });
      await logEvent(data.id, "profile_view");
    } catch (error) {
      req.log.warn({ err: error }, "Restaurant profile metric could not be recorded");
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ success: true, data });
  } catch (error) {
    req.log.error({ err: error }, "Restaurant profile query failed");
    res.status(503).json({
      success: false,
      error: "The restaurant profile is temporarily unavailable.",
    });
  }
});

export default router;