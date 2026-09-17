import { db, restaurantsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { cache } from "../lib/cache";

const router: IRouter = Router();

interface TrendingData {
  cuisines: Array<{ cuisine: string; count: number }>;
  cities: Array<{ city: string; count: number }>;
}

router.get(["/trending", "/trends"], async (req, res) => {
  const cached = cache.get<TrendingData>("trending");
  if (cached) {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, data: cached });
    return;
  }
  try {
    const [cities, cuisineResult] = await Promise.all([
      db
        .select({
          city: restaurantsTable.city,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(restaurantsTable)
        .groupBy(restaurantsTable.city)
        .orderBy(desc(sql`count(*)`))
        .limit(5),
      db.execute<{ cuisine: string; count: number }>(sql`
        select cuisine_tag as cuisine, count(*)::int as count
        from ${restaurantsTable}
        cross join lateral unnest(${restaurantsTable.cuisineTags}) as cuisine_tag
        where cuisine_tag <> ''
        group by cuisine_tag
        order by count(*) desc, cuisine_tag asc
        limit 5
      `),
    ]);
    const data: TrendingData = {
      cities,
      cuisines: cuisineResult.rows.map((row) => ({
        cuisine: row.cuisine,
        count: Number(row.count),
      })),
    };
    cache.set("trending", data);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, data });
  } catch (error) {
    req.log.error({ err: error }, "Trending directory query failed");
    res.status(503).json({
      success: false,
      error: "Trending data is temporarily unavailable.",
    });
  }
});

export default router;