import { db, restaurantsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { cache } from "../lib/cache";

const router: IRouter = Router();

interface CuisinePoint extends Record<string, unknown> {
  cuisine: string;
  lat: number;
  lng: number;
}

router.get(["/heatmap", "/cuisine-locations"], async (req, res) => {
  const cached = cache.get<CuisinePoint[]>("cuisine-heatmap");
  if (cached) {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, data: cached });
    return;
  }
  try {
    const result = await db.execute<CuisinePoint>(sql`
      select cuisine_tag as cuisine,
             ${restaurantsTable.latitude} as lat,
             ${restaurantsTable.longitude} as lng
      from ${restaurantsTable}
      cross join lateral unnest(${restaurantsTable.cuisineTags}) as cuisine_tag
      where ${restaurantsTable.latitude} is not null
        and ${restaurantsTable.longitude} is not null
        and ${restaurantsTable.latitude} between -90 and 90
        and ${restaurantsTable.longitude} between -180 and 180
        and cuisine_tag <> ''
      limit 5000
    `);
    const points = result.rows.map((row) => ({
      cuisine: row.cuisine,
      lat: Number(row.lat),
      lng: Number(row.lng),
    }));
    cache.set("cuisine-heatmap", points);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, data: points });
  } catch (error) {
    req.log.error({ err: error }, "Cuisine heatmap query failed");
    res.status(503).json({
      success: false,
      error: "Cuisine map data is temporarily unavailable.",
    });
  }
});

export default router;