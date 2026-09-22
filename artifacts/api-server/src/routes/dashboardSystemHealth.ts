import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { getDailyOutreachSchedulerStatus } from "../cron/dailyOutreach";
import { getWatchHealthSchedulerStatus } from "../cron/watchHealthCheck";
import { getWatchRenewalSchedulerStatus } from "../cron/watchRenewal";
import { getSchedulerRuns } from "../dashboard/schedulerState";
import { adminOnly } from "../middleware/adminOnly";

type HealthStatus = "healthy" | "degraded" | "error" | "unknown";

interface HealthCheck {
  status: HealthStatus;
  detail: string;
}

const router: IRouter = Router();

function getAIHealth(): HealthCheck {
  const configured = Boolean(
    process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  );
  return configured
    ? {
        status: "healthy",
        detail: "AI credentials are configured. This does not perform a paid provider probe.",
      }
    : {
        status: "degraded",
        detail: "AI credentials are not configured.",
      };
}

function getAutomationHealth(): HealthCheck {
  const schedulers = [
    getDailyOutreachSchedulerStatus(),
    getWatchHealthSchedulerStatus(),
    getWatchRenewalSchedulerStatus(),
  ];
  const enabled = schedulers.filter((scheduler) => scheduler.enabled);
  if (enabled.length === 0) {
    return {
      status: "unknown",
      detail: "No in-process automation schedulers are enabled.",
    };
  }
  if (enabled.some((scheduler) => !scheduler.running)) {
    return {
      status: "error",
      detail: "At least one enabled automation scheduler is not running.",
    };
  }
  const recentRuns = getSchedulerRuns(20);
  if (recentRuns.some((run) => run.outcome === "failed")) {
    return {
      status: "degraded",
      detail: "An automation scheduler has failed within the current process history.",
    };
  }
  return {
    status: "healthy",
    detail: `${enabled.length} enabled automation scheduler${enabled.length === 1 ? " is" : "s are"} running.`,
  };
}

async function getDatabaseHealth(): Promise<HealthCheck> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Database readiness check timed out.")),
          2_000,
        );
      }),
    ]);
    return {
      status: "healthy",
      detail: "PostgreSQL answered a bounded readiness query.",
    };
  } catch {
    return {
      status: "error",
      detail: "PostgreSQL did not answer the readiness query.",
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

router.get("/system-health", adminOnly, async (_req, res) => {
  const database = await getDatabaseHealth();
  res.setHeader("Cache-Control", "no-store");
  res.json({
    checkedAt: new Date().toISOString(),
    scope: "current_process",
    services: {
      ai: getAIHealth(),
      automation: getAutomationHealth(),
      queue: {
        status: "unknown",
        detail: "Queue depth telemetry is not available yet.",
      } satisfies HealthCheck,
      api: {
        status: "healthy",
        detail: `API process is responding; uptime ${Math.floor(process.uptime())} seconds.`,
      } satisfies HealthCheck,
      database,
    },
  });
});

export default router;