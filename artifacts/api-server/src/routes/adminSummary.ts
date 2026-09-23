import {
  db,
  engineHeartbeatsTable,
  globalMetricsSnapshotsTable,
  operationalLogEventsTable,
  restaurantsTable,
} from "@workspace/db";
import { count, desc } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.get("/admin/summary", adminOnly, async (req, res) => {
  try {
    const [heartbeats, [latestMetrics], [restaurantTotal], automationLogs] =
      await Promise.all([
        db
          .select()
          .from(engineHeartbeatsTable)
          .orderBy(desc(engineHeartbeatsTable.lastHeartbeat))
          .limit(10),
        db
          .select()
          .from(globalMetricsSnapshotsTable)
          .orderBy(desc(globalMetricsSnapshotsTable.createdAt))
          .limit(1),
        db.select({ value: count() }).from(restaurantsTable),
        db
          .select()
          .from(operationalLogEventsTable)
          .orderBy(desc(operationalLogEventsTable.createdAt))
          .limit(10),
      ]);

    const restaurantsCount = Number(restaurantTotal?.value ?? 0);

    res.json({
      ok: true,
      heartbeats: heartbeats.map((heartbeat) => ({
        ...heartbeat,
        timestamp: heartbeat.lastHeartbeat,
      })),
      metrics: latestMetrics
        ? {
            ...latestMetrics,
            restaurants: latestMetrics.totalRestaurants,
            queueDepth: 0,
            automationRuns: 0,
          }
        : {
            restaurants: restaurantsCount,
            queueDepth: 0,
            automationRuns: 0,
          },
      restaurantsCount,
      automationLogs,
    });
  } catch (err) {
    req.log.error({ err }, "Admin summary error");
    res.status(500).json({
      ok: false,
      error: "Admin summary crashed",
    });
  }
});

export default router;