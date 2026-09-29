import { Router, type IRouter } from "express";
import { getRecentHealth, computeDailyHealthScore } from "../health/scraperHealth";
import { adminOnly } from "../middleware/adminOnly";
import { getInsertionQueueStatus } from "../pipeline/insertService";
import { getEngineStatuses, recordHeartbeat } from "../services/engineHeartbeat";
import { getEngineLatencyAlerts, getEnginePerformanceMetrics } from "../services/operationalLog";
import { getSystemHealthSnapshot } from "./dashboardSystemHealth";

const router: IRouter = Router();
const services = ["ai", "automation", "queue", "api", "database"] as const;

router.use(adminOnly);

router.get("/operations/queue", (_req, res) => {
  const snapshot = getInsertionQueueStatus(50);
  res.json({
    success: true,
    checkedAt: new Date().toISOString(),
    queue: {
      pending: snapshot.pending,
      capacity: snapshot.capacity,
      draining: snapshot.draining,
      scope: snapshot.scope,
      resetsOnRestart: snapshot.resetsOnRestart,
      items: snapshot.items.map((item) => ({
        jobId: item.jobId,
        kind: item.kind,
        label: item.label,
        city: item.city,
        queuedAt: item.queuedAt,
      })),
    },
  });
});

router.get("/operations/engines", async (req, res) => {
  try {
    await Promise.all([recordHeartbeat("api"), recordHeartbeat("database")]);
    const statuses = await getEngineStatuses();
    let metrics: Awaited<ReturnType<typeof getEnginePerformanceMetrics>> = {};
    let alerts: Awaited<ReturnType<typeof getEngineLatencyAlerts>> = {};
    let partial = false;
    try {
      [metrics, alerts] = await Promise.all([getEnginePerformanceMetrics(), getEngineLatencyAlerts()]);
    } catch (error) {
      req.log.warn({ err: error }, "Admin engine latency metrics unavailable.");
      partial = true;
    }
    res.json({
      success: true,
      checkedAt: new Date().toISOString(),
      partial,
      availabilityScope: "durable_heartbeats",
      outcomeWindow: "last_5_minutes",
      services: services.map((service) => {
        const outcome = metrics[service];
        return {
          id: service,
          supported: true,
          availability: statuses[service] ?? "offline",
          outcomes: {
            total: outcome?.total ?? 0,
            succeeded: outcome?.successes ?? 0,
            failed: outcome?.errors ?? 0,
          },
          latency: {
            instrumented: true,
            averageMs: outcome?.avg_latency_ms ?? null,
            p95Ms: outcome?.p95_latency_ms ?? null,
            samples: outcome?.latency_samples ?? 0,
            available: !partial && (outcome?.latency_samples ?? 0) > 0,
            alert: partial ? { status: "unavailable" } : alerts[service],
          },
        };
      }),
    });
  } catch (error) {
    req.log.error({ err: error }, "Admin engine status failed.");
    res.status(503).json({ success: false, error: "Engine status is unavailable." });
  }
});

router.get("/operations/health", async (req, res) => {
  try {
    const readiness = await getSystemHealthSnapshot();
    res.json({
      success: true,
      checkedAt: readiness.checkedAt,
      sections: {
        readiness: {
          scope: "current_process",
          durable: false,
          services: readiness.services,
        },
        scraper: {
          scope: "current_process",
          durable: false,
          score: computeDailyHealthScore(),
          recent: getRecentHealth(20),
        },
        heartbeats: {
          scope: "database",
          durable: true,
          note: "Engine heartbeat timestamps persist across process restarts.",
        },
      },
    });
  } catch (error) {
    req.log.error({ err: error }, "Admin health status failed.");
    res.status(503).json({ success: false, error: "Health status is unavailable." });
  }
});

export default router;