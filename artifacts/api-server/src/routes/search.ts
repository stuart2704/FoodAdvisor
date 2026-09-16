import {
  db,
  restaurantsTable,
  restaurantSearchEventsTable,
} from "@workspace/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { scoreSearchRelevance } from "../services/searchRelevanceService";
import { calculateRanking } from "../services/rankingEngine";
import { logEvent } from "../services/analyticsEngine";
import {
  getVisitorProfile,
  personaliseSearch,
} from "../services/personalisationEngine";

const router: IRouter = Router();

const SearchQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    city: z.string().trim().max(100).optional(),
    cuisine: z.string().trim().max(100).optional(),
    price: z.string().trim().max(30).optional(),
    premiumOnly: z.enum(["true", "false"]).default("false"),
    ai: z.enum(["true", "false"]).default("false"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function searchRestaurants(req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  const parsed = SearchQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: "Search filters are invalid.",
    });
    return;
  }
  const { q, city, cuisine, price, premiumOnly, ai, page, limit } = parsed.data;
  if (price) {
    res.status(400).json({
      success: false,
      error: "Price filtering is unavailable because price levels are not stored yet.",
    });
    return;
  }
  const conditions = [];
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(
      or(
        ilike(restaurantsTable.name, pattern),
        ilike(restaurantsTable.city, pattern),
        ilike(restaurantsTable.address, pattern),
        sql`exists (
          select 1
          from unnest(
            ${restaurantsTable.cuisineTags} || ${restaurantsTable.dietaryTags}
          ) as search_tag
          where search_tag ilike ${pattern}
        )`,
      ),
    );
  }
  if (city) conditions.push(ilike(restaurantsTable.city, escapeLike(city)));
  if (cuisine) {
    conditions.push(sql`exists (
      select 1 from unnest(${restaurantsTable.cuisineTags}) as cuisine_tag
      where lower(cuisine_tag) = lower(${cuisine})
    )`);
  }
  if (premiumOnly === "true") {
    conditions.push(eq(restaurantsTable.premium, true));
  }

  try {
    const rows = await db
      .select()
      .from(restaurantsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(
        desc(restaurantsTable.premium),
        desc(restaurantsTable.rating),
        desc(restaurantsTable.importedAt),
      )
      .limit(Math.min(200, page * limit * 4));

    const aiBoosts = new Map<string, number | null>();
    if (ai === "true" && q) {
      const shortlist = rows.slice(0, 8);
      for (let index = 0; index < shortlist.length; index += 2) {
        const batch = shortlist.slice(index, index + 2);
        const scores = await Promise.all(
          batch.map((row) =>
            scoreSearchRelevance(q, {
              id: row.placeId,
              name: row.name,
              city: row.city,
              cuisine: row.cuisineTags[0] ?? null,
              tags: [...new Set([...row.cuisineTags, ...row.dietaryTags])],
              premium: row.premium,
            }),
          ),
        );
        batch.forEach((row, batchIndex) => {
          aiBoosts.set(row.placeId, scores[batchIndex] ?? null);
        });
      }
    }

    const ranked = rows
      .map((row) => ({
        id: row.placeId,
        name: row.name,
        cuisine: row.cuisineTags[0] ?? null,
        city: row.city,
        country: "United Kingdom",
        priceLevel: null,
        tags: [...new Set([...row.cuisineTags, ...row.dietaryTags])],
        premium: row.premium,
        score: row.qualificationScore,
        popularity: row.popularity,
        aiRelevanceBoost:
          aiBoosts.get(row.placeId) ?? row.aiRelevanceBoost,
        rankingScore: calculateRanking({
          premium: row.premium,
          score: row.qualificationScore,
          popularity: row.popularity,
          aiRelevanceBoost:
            aiBoosts.get(row.placeId) ?? row.aiRelevanceBoost,
          city: row.city,
          country: "United Kingdom",
          cuisine: row.cuisineTags[0] ?? null,
        }),
      }))
      .sort(
        (left, right) => right.rankingScore - left.rankingScore,
      );
    const visitorId = req.get("X-Visitor-Id");
    let personalisedResults = ranked;
    if (visitorId) {
      try {
        const profile = await getVisitorProfile(visitorId);
        if (profile) personalisedResults = personaliseSearch(ranked, profile);
      } catch {
        res.status(400).json({
          success: false,
          error: "The visitor profile identifier is invalid.",
        });
        return;
      }
    }
    const offset = (page - 1) * limit;
    const results = personalisedResults.slice(offset, offset + limit);

    const aiScoredCount = [...aiBoosts.values()].filter(
      (value): value is number => value !== null,
    ).length;
    try {
      await db.insert(restaurantSearchEventsTable).values({
        queryProvided: Boolean(q),
        cityFiltered: Boolean(city),
        cuisineFiltered: Boolean(cuisine),
        premiumOnly: premiumOnly === "true",
        aiRequested: ai === "true",
        aiScoredCount,
        resultCount: results.length,
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    } catch (error) {
      req.log.warn({ err: error }, "Search metric could not be recorded");
    }
    const impressionResults = await Promise.allSettled(
      results.map((restaurant, index) =>
        logEvent(restaurant.id, "search_impression", {
          position: offset + index + 1,
          queryProvided: Boolean(q),
          cityFiltered: Boolean(city),
          cuisineFiltered: Boolean(cuisine),
          premiumOnly: premiumOnly === "true",
        }),
      ),
    );
    if (impressionResults.some((result) => result.status === "rejected")) {
      req.log.warn("One or more search impressions could not be recorded");
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "X-Visitor-Id");
    res.setHeader("Cache-Control", visitorId ? "private, no-store" : "no-store");
    res.json({
      success: true,
      results,
      page,
      limit,
      hasMore: ranked.length > offset + results.length,
      aiApplied: ai === "true" && Boolean(q),
      aiScoredCount,
    });
  } catch (error) {
    req.log.error({ err: error }, "Restaurant search failed");
    res.status(503).json({
      success: false,
      error: "Restaurant search is temporarily unavailable.",
    });
  }
}

const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many searches. Please try again later." },
});

router.get("/search", searchLimiter, searchRestaurants);
router.get("/restaurants/search", searchLimiter, searchRestaurants);

export default router;