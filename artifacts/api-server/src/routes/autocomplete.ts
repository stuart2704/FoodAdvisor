import { db, restaurantsTable } from "@workspace/db";
import { desc, ilike } from "drizzle-orm";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const router: IRouter = Router();

const AutocompleteQuery = z.object({
  q: z.string().trim().min(2).max(120),
});

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

router.get("/autocomplete", limiter, async (req, res) => {
  const parsed = AutocompleteQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Enter at least two characters." });
    return;
  }
  try {
    const results = await db
      .select({
        id: restaurantsTable.placeId,
        name: restaurantsTable.name,
        slug: restaurantsTable.slug,
        city: restaurantsTable.city,
      })
      .from(restaurantsTable)
      .where(ilike(restaurantsTable.name, `%${escapeLike(parsed.data.q)}%`))
      .orderBy(desc(restaurantsTable.premium), desc(restaurantsTable.rating))
      .limit(10);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, results });
  } catch (error) {
    req.log.error({ err: error }, "Autocomplete query failed");
    res.status(503).json({ success: false, error: "Autocomplete is unavailable." });
  }
});

export default router;