import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import { getDirectoryPage } from "../services/directoryEngine";
import { db, directoryViewEventsTable } from "@workspace/db";

const router: IRouter = Router();

const DirectoryQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    city: z.string().trim().max(100).optional(),
    cuisine: z.string().trim().max(100).optional(),
    price: z.string().trim().max(30).optional(),
    premiumOnly: z.enum(["true", "false"]).default("false"),
  })
  .strict();

async function directoryHandler(
  req: Request,
  res: Response,
) {
  const parsed = DirectoryQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: "Directory filters are invalid.",
    });
    return;
  }
  try {
    const data = await getDirectoryPage({
      page: parsed.data.page,
      city: parsed.data.city,
      cuisine: parsed.data.cuisine,
      price: parsed.data.price,
      premiumOnly: parsed.data.premiumOnly === "true",
    });
    try {
      await db.insert(directoryViewEventsTable).values({
        page: data.page,
        resultCount: data.items.length,
        cityFiltered: Boolean(parsed.data.city),
        cuisineFiltered: Boolean(parsed.data.cuisine),
        priceFiltered: Boolean(parsed.data.price),
        premiumOnly: parsed.data.premiumOnly === "true",
      });
    } catch (error) {
      req.log.warn({ err: error }, "Directory metric could not be recorded");
    }
    res.setHeader("Cache-Control", "public, max-age=120");
    res.json({ success: true, data });
  } catch (error) {
    req.log.error({ err: error }, "Restaurant directory query failed");
    res.status(503).json({
      success: false,
      error: "The restaurant directory is temporarily unavailable.",
    });
  }
}

router.get("/directory", directoryHandler);

export default router;