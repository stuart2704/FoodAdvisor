import { db, restaurantsTable } from "@workspace/db";
import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { adminOnly } from "../middleware/adminOnly";
import { cache } from "../lib/cache";
import { preserveVanishedLocation } from "../utils/locationAliases";

const router: IRouter = Router();
const RenameBody = z.object({
  kind: z.enum(["city", "region"]),
  from: z.string().trim().min(1).max(100),
  to: z.string().trim().min(1).max(100),
});

router.post("/admin/locations/rename", adminOnly, async (req, res): Promise<void> => {
  const parsed = RenameBody.safeParse(req.body);
  if (!parsed.success || parsed.data.from === parsed.data.to) {
    res.status(400).json({ error: "Invalid location rename." });
    return;
  }
  const { kind, from, to } = parsed.data;
  const column = kind === "city" ? restaurantsTable.city : restaurantsTable.region;
  try {
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(734662, 1)`);
      const names = await tx.selectDistinct({ name: column }).from(restaurantsTable)
        .where(kind === "region" ? isNotNull(column) : undefined)
        .orderBy(asc(column)).limit(1_000);
      const before = names.flatMap(row => row.name ? [row.name] : []);
      if (!before.includes(from)) return "missing";
      if (before.includes(to)) return "conflict";
      await tx.update(restaurantsTable).set({ [kind]: to })
        .where(eq(column, from)).returning({ id: restaurantsTable.placeId });
      await preserveVanishedLocation(tx, kind, from, to, before);
      return "renamed";
    });
    if (outcome === "missing") {
      res.status(404).json({ error: "Location not found." });
      return;
    }
    if (outcome === "conflict") {
      res.status(409).json({ error: "Destination location already exists." });
      return;
    }
    if (kind === "city") cache.del("cities");
    res.json({ kind, from, to });
  } catch (error) {
    req.log.error({ err: error }, "Location rename failed");
    res.status(503).json({ error: "Location could not be renamed." });
  }
});

export default router;