import { db, restaurantsTable } from "@workspace/db";
import { desc, ilike, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const router: IRouter = Router();

const MatchBody = z.object({
  cuisine: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
});

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/match", limiter, async (req, res) => {
  const parsed = MatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Cuisine and region are required." });
    return;
  }
  try {
    const results = await db
      .select({
        id: restaurantsTable.placeId,
        name: restaurantsTable.name,
        slug: restaurantsTable.slug,
        city: restaurantsTable.city,
        region: restaurantsTable.region,
        cuisine: sql<string | null>`${restaurantsTable.cuisineTags}[1]`,
        rating: restaurantsTable.rating,
        premium: restaurantsTable.premium,
      })
      .from(restaurantsTable)
      .where(
        sql`${ilike(restaurantsTable.region, parsed.data.region)}
          and exists (
            select 1 from unnest(${restaurantsTable.cuisineTags}) as cuisine_tag
            where cuisine_tag ilike ${parsed.data.cuisine}
          )`,
      )
      .orderBy(desc(restaurantsTable.premium), desc(restaurantsTable.rating))
      .limit(5);
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, results });
  } catch (error) {
    req.log.error({ err: error }, "Restaurant matching failed");
    res.status(503).json({ success: false, error: "Matches are unavailable." });
  }
});

export default router;