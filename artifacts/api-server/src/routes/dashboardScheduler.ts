import { Router, type IRouter } from "express";
import { z } from "zod";
import { getWatchHealthSchedulerStatus } from "../cron/watchHealthCheck";
import { getWatchRenewalSchedulerStatus } from "../cron/watchRenewal";
import { getDailyOutreachSchedulerStatus } from "../cron/dailyOutreach";
import { getSchedulerRuns } from "../dashboard/schedulerState";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.get("/scheduler", adminOnly, (_req, res) => {
  const schedulers = [
    getDailyOutreachSchedulerStatus(),
    getWatchHealthSchedulerStatus(),
    getWatchRenewalSchedulerStatus(),
  ];
  const runs = getSchedulerRuns(100);
  const nextRuns = schedulers
    .map((scheduler) => scheduler.nextRunAt)
    .filter((value): value is string => value !== null)
    .sort();
  res.json({
    success: true,
    lastRun: runs[0]?.completedAt ?? null,
    nextRun: nextRuns[0] ?? null,
    processed: 0,
    aiCalls: 0,
    emailsSent: 0,
    errors: runs
      .filter((run) => run.outcome === "failed")
      .map((run) => run.message),
    scope: "current_process",
    metricsNote:
      "Daily outreach runs at 08:00 local server time. Gmail watch schedulers maintain inbound reply delivery.",
    deploymentNote:
      "In-process schedules require an always-running server. Autoscale should invoke protected endpoints from an external scheduler.",
    schedulers,
  });
});

router.get("/scheduler/history", adminOnly, (req, res) => {
  const parsed = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid history limit." });
    return;
  }

  const items = getSchedulerRuns(parsed.data.limit);
  res.json({
    success: true,
    scope: "current_process",
    resetsOnRestart: true,
    total: items.length,
    items,
  });
});

export default router;