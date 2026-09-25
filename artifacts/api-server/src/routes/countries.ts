import { db, restaurantsTable } from "@workspace/db";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { locationSlugs, slugify } from "../utils/slugify";

const router: IRouter = Router();

const CountrySlugParams = z.object({
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

router.get("/countries", async (req, res) => {
  try {
    const rows = await db
      .select({
        country: restaurantsTable.country,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(restaurantsTable)
      .where(and(isNotNull(restaurantsTable.country), eq(restaurantsTable.published, true)))
      .groupBy(restaurantsTable.country)
      .orderBy(asc(restaurantsTable.country))
      .limit(250);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(
      rows.flatMap((row) =>
        row.country
          ? [{
              country: row.country,
              slug: slugify(row.country),
              count: row.count,
            }]
          : [],
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Country directory query failed");
    res.status(503).json({ error: "Countries are temporarily unavailable." });
  }
});

router.get("/countries/:slug", async (req, res) => {
  const parsed = CountrySlugParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid country slug." });
    return;
  }
  try {
    const countries = await db
      .selectDistinct({ country: restaurantsTable.country })
      .from(restaurantsTable)
      .where(and(isNotNull(restaurantsTable.country), eq(restaurantsTable.published, true)))
      .limit(250);
    const country = countries.find(
      (row) => row.country && slugify(row.country) === parsed.data.slug,
    )?.country;
    if (!country) {
      res.status(404).json({ error: "Country not found." });
      return;
    }
    const cities = await db
      .select({
        city: restaurantsTable.city,
        region: restaurantsTable.region,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(restaurantsTable)
      .where(and(
        eq(restaurantsTable.country, country),
        eq(restaurantsTable.published, true),
      ))
      .groupBy(restaurantsTable.city, restaurantsTable.region)
      .orderBy(asc(restaurantsTable.city))
      .limit(1_000);
    const allCities = await db
      .selectDistinct({ city: restaurantsTable.city })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.published, true))
      .orderBy(asc(restaurantsTable.city))
      .limit(1_000);
    const citySlugs = locationSlugs(allCities.map((row) => row.city));
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      country,
      cities: cities.map((city) => ({
        ...city,
        slug: citySlugs.get(city.city)!,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Country directory detail query failed");
    res.status(503).json({
      error: "Country cities are temporarily unavailable.",
    });
  }
});

export default router;