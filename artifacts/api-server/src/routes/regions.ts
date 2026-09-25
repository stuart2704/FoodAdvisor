import { db, restaurantsTable } from "@workspace/db";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { locationSlugs } from "../utils/slugify";
import { aliasTarget, canonicalLocationLink, canonicalLocationPath } from "../utils/locationAliases";

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
      .where(and(isNotNull(restaurantsTable.region), eq(restaurantsTable.published, true)))
      .groupBy(restaurantsTable.region)
      .orderBy(asc(restaurantsTable.region))
      .limit(1_000);
    const regions = rows.filter((row): row is typeof row & { region: string } => !!row.region);
    const slugs = locationSlugs(regions.map((row) => row.region));
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(regions.map((row) => ({
      region: row.region, slug: slugs.get(row.region)!, count: row.count,
    })));
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
      .where(and(isNotNull(restaurantsTable.region), eq(restaurantsTable.published, true)))
       .orderBy(asc(restaurantsTable.region))
      .limit(1_000);
    const slugs = locationSlugs(regions.flatMap((row) => row.region ? [row.region] : []));
    const region = regions.find(
      (row) => row.region && slugs.get(row.region) === parsed.data.slug,
    )?.region;
    if (!region) {
      const target = await aliasTarget("region", parsed.data.slug);
      const canonicalSlug = target && slugs.get(target);
      if (canonicalSlug) {
        const path = canonicalLocationPath("region", canonicalSlug);
        res.setHeader("Link", canonicalLocationLink(path));
        res.setHeader("Cache-Control", "public, max-age=300");
        res.redirect(308, path);
        return;
      }
      res.status(404).json({ error: "Region not found." });
      return;
    }
    const cities = await db
      .select({
        city: restaurantsTable.city,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(restaurantsTable)
      .where(and(
        eq(restaurantsTable.region, region),
        eq(restaurantsTable.published, true),
      ))
      .groupBy(restaurantsTable.city)
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
    res.setHeader("Link", canonicalLocationLink(canonicalLocationPath("region", parsed.data.slug)));
    res.json({
      region,
      cities: cities.map((city) => ({
        ...city,
        slug: citySlugs.get(city.city)!,
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