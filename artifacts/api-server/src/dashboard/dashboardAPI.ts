import { Router } from "express";
import { validAutomationToken } from "../lib/automation-auth";
import { getEvents } from "../utils/eventLog";
import { getRecentHealth, computeDailyHealthScore } from "../health/scraperHealth";
import { getStatusCounts } from "./statusStats";
import { getErrorSummary } from "./errorSummary";

export const dashboardRouter = Router();
dashboardRouter.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!validAutomationToken(req.header("authorization"))) {
    res.status(401).json({ error: "Invalid automation credential." });
    return;
  }
  next();
});

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
dashboardRouter.get("/summary", async (_req, res) => {
  try {
    const statusCounts = await getStatusCounts();
    res.json({
      statusCounts, healthScore: computeDailyHealthScore(), recentEvents: getEvents().slice(-10),
      healthScope: "current_process",
    });
  } catch { res.status(503).json({ error: "Dashboard summary is unavailable." }); }
});