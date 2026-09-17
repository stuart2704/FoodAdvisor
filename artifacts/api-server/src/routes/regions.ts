import { db, restaurantsTable } from "@workspace/db";
import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { slugify } from "../utils/slugify";

const router: IRouter = Router();

const RegionSlugParams = z.object({
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

router.get("/regions", async (req, res) => {
  try {
    const rows = await db
      .select({
        region: restaurantsTable.region,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(restaurantsTable)
      .where(isNotNull(restaurantsTable.region))
      .groupBy(restaurantsTable.region)
      .orderBy(asc(restaurantsTable.region))
      .limit(1_000);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(
      rows.flatMap((row) =>
        row.region
          ? [{ region: row.region, slug: slugify(row.region), count: row.count }]
          : [],
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Region directory query failed");
    res.status(503).json({ error: "Regions are temporarily unavailable." });
  }
});

router.get("/regions/:slug", async (req, res) => {
  const parsed = RegionSlugParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid region slug." });
    return;
  }
  try {
    const regions = await db
      .selectDistinct({ region: restaurantsTable.region })
      .from(restaurantsTable)
      .where(isNotNull(restaurantsTable.region))
      .limit(1_000);
    const region = regions.find(
      (row) => row.region && slugify(row.region) === parsed.data.slug,
    )?.region;
    if (!region) {
      res.status(404).json({ error: "Region not found." });
      return;
    }
    const cities = await db
      .select({
        city: restaurantsTable.city,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.region, region))
      .groupBy(restaurantsTable.city)
      .orderBy(asc(restaurantsTable.city))
      .limit(1_000);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      region,
      cities: cities.map((city) => ({
        ...city,
        slug: slugify(city.city),
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Region directory detail query failed");
    res.status(503).json({
      error: "Region cities are temporarily unavailable.",
    });
  }
});

export default router;