import { db, restaurantMenuItemsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { validateToken } from "../services/portalTokenService";

const router: IRouter = Router();

const MenuParams = z.object({
  id: z.string().trim().min(1).max(512),
});

const PortalMenuParams = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

const MenuItemBody = z.object({
  name: z.string().trim().min(1).max(200),
  price: z.string().trim().max(40).nullable().optional(),
  description: z.string().trim().max(1_000).nullable().optional(),
  category: z.string().trim().min(1).max(100),
});

const menuWriteLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/menus/:id", async (req, res) => {
  const parsed = MenuParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid restaurant ID." });
    return;
  }
  try {
    const items = await db
      .select({
        id: restaurantMenuItemsTable.id,
        name: restaurantMenuItemsTable.name,
        price: restaurantMenuItemsTable.price,
        description: restaurantMenuItemsTable.description,
        category: restaurantMenuItemsTable.category,
      })
      .from(restaurantMenuItemsTable)
      .where(eq(restaurantMenuItemsTable.restaurantId, parsed.data.id))
      .orderBy(
        asc(restaurantMenuItemsTable.category),
        asc(restaurantMenuItemsTable.name),
      );
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ success: true, data: items });
  } catch (error) {
    req.log.error({ err: error }, "Menu query failed");
    res.status(503).json({ success: false, error: "Menu is unavailable." });
  }
});

router.post("/portal/:token/menu", menuWriteLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
  const params = PortalMenuParams.safeParse(req.params);
  const body = MenuItemBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ success: false, error: "Menu item details are invalid." });
    return;
  }
  const restaurantId = await validateToken(params.data.token);
  if (!restaurantId) {
    res.status(404).json({ success: false, error: "Invalid or expired login link." });
    return;
  }
  try {
    const [item] = await db
      .insert(restaurantMenuItemsTable)
      .values({
        restaurantId,
        name: body.data.name,
        price: body.data.price || null,
        description: body.data.description || null,
        category: body.data.category,
      })
      .returning({
        id: restaurantMenuItemsTable.id,
        name: restaurantMenuItemsTable.name,
        price: restaurantMenuItemsTable.price,
        description: restaurantMenuItemsTable.description,
        category: restaurantMenuItemsTable.category,
      });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    req.log.error({ err: error }, "Menu item creation failed");
    res.status(503).json({ success: false, error: "Menu item could not be added." });
  }
});

export default router;