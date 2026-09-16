import { Router } from "express";
import { db, restaurantsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import { adminOnly } from "../middleware/adminOnly";
import { getEvents } from "../utils/eventLog";
import { getRecentHealth, computeDailyHealthScore } from "../health/scraperHealth";
import { getStatusCounts } from "./statusStats";
import { getErrorSummary } from "./errorSummary";

export const dashboardRouter = Router();
dashboardRouter.use(adminOnly);

// Preserve the existing raw {time,type,message,category?} events contract.
dashboardRouter.get("/events", (_req, res) => { res.json(getEvents()); });
dashboardRouter.get("/health", (_req, res) => {
  res.json({
    recent: getRecentHealth(), score: computeDailyHealthScore(),
    scope: "current_process", scoringWindow: "last_10_samples_today_utc",
  });
});
dashboardRouter.get("/status", async (_req, res) => {
  try { res.json(await getStatusCounts()); }
  catch { res.status(503).json({ error: "Dashboard status counts are unavailable." }); }
});
dashboardRouter.get("/errors", (_req, res) => { res.json(getErrorSummary()); });
dashboardRouter.get("/stats", async (_req, res) => {
  try {
    const statusCounts = await getStatusCounts();
    res.json({
      success: true,
      statusCounts,
      healthScore: computeDailyHealthScore(),
      recentEvents: getEvents().slice(-10),
      healthScope: "current_process",
    });
  } catch {
    res.status(503).json({ error: "Dashboard stats are unavailable." });
  }
});
dashboardRouter.get("/restaurants", async (req, res) => {
  const pagination = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .safeParse(req.query);
  if (!pagination.success) {
    res.status(400).json({ success: false, error: "Invalid pagination." });
    return;
  }

  const { page, limit } = pagination.data;
  const offset = (page - 1) * limit;
  try {
    const [[countRow], restaurants] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(restaurantsTable),
      db
        .select({
          placeId: restaurantsTable.placeId,
          name: restaurantsTable.name,
          address: restaurantsTable.address,
          city: restaurantsTable.city,
          rating: restaurantsTable.rating,
          website: restaurantsTable.website,
          publicBusinessEmail: restaurantsTable.publicBusinessEmail,
          outreachStatus: restaurantsTable.outreachStatus,
          outreachCount: restaurantsTable.outreachCount,
          claimStatus: restaurantsTable.claimStatus,
          importedAt: restaurantsTable.importedAt,
        })
        .from(restaurantsTable)
        .orderBy(desc(restaurantsTable.importedAt), restaurantsTable.placeId)
        .limit(limit)
        .offset(offset),
    ]);
    res.json({
      success: true,
      page,
      limit,
      total: countRow?.count ?? 0,
      restaurants,
    });
  } catch {
    res.status(503).json({
      success: false,
      error: "Dashboard restaurants are unavailable.",
    });
  }
});
dashboardRouter.get("/summary", async (_req, res) => {
  try {
    const statusCounts = await getStatusCounts();
    res.json({
      statusCounts, healthScore: computeDailyHealthScore(), recentEvents: getEvents().slice(-10),
      healthScope: "current_process",
    });
  } catch { res.status(503).json({ error: "Dashboard summary is unavailable." }); }
});