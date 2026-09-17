import { db, restaurantsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";

const router: IRouter = Router();

const BrandParams = z.object({
  brand: z.string().trim().min(1).max(120),
});

router.get(
  ["/brand/:brand", "/brands/:brand", "/franchise/:brand"],
  async (req, res) => {
  const parsed = BrandParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid brand." });
    return;
  }
  try {
    const restaurants = await db
      .select({
        id: restaurantsTable.placeId,
        slug: restaurantsTable.slug,
        name: restaurantsTable.name,
        brand: restaurantsTable.brand,
        city: restaurantsTable.city,
        country: restaurantsTable.country,
        cuisineTags: restaurantsTable.cuisineTags,
        rating: restaurantsTable.rating,
        premium: restaurantsTable.premium,
      })
      .from(restaurantsTable)
      .where(
        sql`lower(${restaurantsTable.brand}) = lower(${parsed.data.brand})`,
      )
      .orderBy(
        desc(restaurantsTable.premium),
        desc(restaurantsTable.rankingScore),
        desc(restaurantsTable.rating),
      )
      .limit(100);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, data: restaurants });
  } catch (error) {
    req.log.error({ err: error }, "Brand directory query failed");
    res.status(503).json({
      success: false,
      error: "Brand restaurants are temporarily unavailable.",
    });
  }
  },
);

export default router;