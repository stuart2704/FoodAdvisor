import { db, restaurantMenuItemsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

const router: IRouter = Router();

const ClassifyParams = z.object({
  id: z.string().trim().min(1).max(512),
});

const cuisineKeywords = {
  Japanese: /\b(sushi|ramen|tempura|udon|sashimi|yakitori)\b/gi,
  Mexican: /\b(taco|burrito|quesadilla|enchilada|guacamole|tamale)\b/gi,
  Italian: /\b(pasta|pizza|risotto|gnocchi|lasagne|tiramisu)\b/gi,
  Indian: /\b(curry|masala|naan|biryani|tandoori|paneer)\b/gi,
} as const;

const classifyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/classify/:id", classifyLimiter, async (req, res) => {
  const parsed = ClassifyParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid restaurant ID." });
    return;
  }
  try {
    const menu = await db
      .select({
        name: restaurantMenuItemsTable.name,
        description: restaurantMenuItemsTable.description,
      })
      .from(restaurantMenuItemsTable)
      .where(eq(restaurantMenuItemsTable.restaurantId, parsed.data.id))
      .limit(500);
    const text = menu
      .map((item) => `${item.name} ${item.description ?? ""}`)
      .join(" ");
    const best = Object.entries(cuisineKeywords)
      .map(([cuisine, pattern]) => ({
        cuisine,
        matches: text.match(pattern)?.length ?? 0,
      }))
      .sort(
        (left, right) =>
          right.matches - left.matches ||
          left.cuisine.localeCompare(right.cuisine),
      )[0];
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      success: true,
      cuisine: best && best.matches > 0 ? best.cuisine : "Unknown",
    });
  } catch (error) {
    req.log.error({ err: error }, "Menu cuisine classification failed");
    res.status(503).json({
      success: false,
      error: "Cuisine classification is unavailable.",
    });
  }
});

export default router;