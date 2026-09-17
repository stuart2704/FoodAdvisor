import { db, restaurantsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const router: IRouter = Router();

const ChatBody = z.object({
  message: z.string().trim().min(2).max(500),
});

const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function includesTerm(message: string, term: string): boolean {
  return message.toLocaleLowerCase().includes(term.toLocaleLowerCase());
}

async function handleChat(req: Request, res: Response): Promise<void> {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Enter a valid message." });
    return;
  }
  try {
    const [cities, cuisineRows] = await Promise.all([
      db
        .selectDistinct({ city: restaurantsTable.city })
        .from(restaurantsTable)
        .limit(1_000),
      db
        .select({
          cuisine: sql<string>`unnest(${restaurantsTable.cuisineTags})`,
        })
        .from(restaurantsTable)
        .limit(2_000),
    ]);
    const city = cities
      .map((row) => row.city)
      .sort((left, right) => right.length - left.length)
      .find((value) => includesTerm(parsed.data.message, value));
    const cuisine = [...new Set(cuisineRows.map((row) => row.cuisine))]
      .sort((left, right) => right.length - left.length)
      .find((value) => includesTerm(parsed.data.message, value));

    if (!city && !cuisine) {
      res.json({
        success: true,
        reply:
          "I can help you find restaurants. Try including a cuisine or city, such as Italian in Cardiff.",
        results: [],
      });
      return;
    }

    const conditions = [];
    if (city) conditions.push(eq(restaurantsTable.city, city));
    if (cuisine) {
      conditions.push(sql`${cuisine} = any(${restaurantsTable.cuisineTags})`);
    }
    const results = await db
      .select({
        id: restaurantsTable.placeId,
        name: restaurantsTable.name,
        slug: restaurantsTable.slug,
        city: restaurantsTable.city,
        cuisine: sql<string | null>`${restaurantsTable.cuisineTags}[1]`,
        rating: restaurantsTable.rating,
        premium: restaurantsTable.premium,
      })
      .from(restaurantsTable)
      .where(sql.join(conditions, sql` and `))
      .orderBy(desc(restaurantsTable.premium), desc(restaurantsTable.rating))
      .limit(5);

    const subject = [cuisine, city ? `in ${city}` : null]
      .filter(Boolean)
      .join(" ");
    res.json({
      success: true,
      reply:
        results.length > 0
          ? `Top ${subject} restaurants: ${results.map((item) => item.name).join(", ")}.`
          : `I couldn't find matching ${subject} restaurants.`,
      results,
    });
  } catch (error) {
    req.log.error({ err: error }, "Restaurant assistant failed");
    res.status(503).json({
      success: false,
      error: "The restaurant assistant is temporarily unavailable.",
    });
  }
}

router.post("/chat", chatLimiter, handleChat);
router.post("/chatbot", chatLimiter, handleChat);

export default router;