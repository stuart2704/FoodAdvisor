import { Router, type IRouter } from "express";
import { z } from "zod";
import { getCityPage } from "../services/cityPageEngine";
import { cityPageViewEventsTable, db } from "@workspace/db";
import { restaurantsTable } from "@workspace/db";
import { asc, desc, eq, sql } from "drizzle-orm";
import { slugify } from "../utils/slugify";
import { cache } from "../lib/cache";

const router: IRouter = Router();

const CityParams = z.object({
  city: z.string().trim().min(1).max(100),
});

const CitySlugParams = z.object({
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

router.get("/cities", async (req, res) => {
  const cached = cache.get<Array<{ city: string; slug: string; count: number }>>(
    "cities",
  );
  if (cached) {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(cached);
    return;
  }
  try {
    const rows = await db
      .select({
        city: restaurantsTable.city,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(restaurantsTable)
      .groupBy(restaurantsTable.city)
      .orderBy(asc(restaurantsTable.city))
      .limit(1_000);
    const cities = rows.map((row) => ({
        city: row.city,
        slug: slugify(row.city),
        count: row.count,
      }));
    cache.set("cities", cities);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(cities);
  } catch (error) {
    req.log.error({ err: error }, "City directory query failed");
    res.status(503).json({ error: "Cities are temporarily unavailable." });
  }
});

router.get("/cities/:slug", async (req, res) => {
  const parsed = CitySlugParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid city slug." });
    return;
  }
  try {
    const cities = await db
      .selectDistinct({ city: restaurantsTable.city })
      .from(restaurantsTable)
      .limit(1_000);
    const city = cities.find((row) => slugify(row.city) === parsed.data.slug)?.city;
    if (!city) {
      res.status(404).json({ error: "City not found." });
      return;
    }
    const restaurants = await db
      .select({
        id: restaurantsTable.placeId,
        slug: restaurantsTable.slug,
        name: restaurantsTable.name,
        address: restaurantsTable.address,
        city: restaurantsTable.city,
        region: restaurantsTable.region,
        country: restaurantsTable.country,
        globalRegion: restaurantsTable.globalRegion,
        cuisineTags: restaurantsTable.cuisineTags,
        dietaryTags: restaurantsTable.dietaryTags,
        rating: restaurantsTable.rating,
        priceLevel: restaurantsTable.priceLevel,
        website: restaurantsTable.website,
        googleMapsUrl: restaurantsTable.googleMapsUrl,
        premium: restaurantsTable.premium,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.city, city))
      .orderBy(
        desc(restaurantsTable.premium),
        desc(restaurantsTable.rankingScore),
        restaurantsTable.name,
      )
      .limit(500);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ city, restaurants });
  } catch (error) {
    req.log.error({ err: error }, "City directory detail query failed");
    res.status(503).json({ error: "City restaurants are temporarily unavailable." });
  }
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