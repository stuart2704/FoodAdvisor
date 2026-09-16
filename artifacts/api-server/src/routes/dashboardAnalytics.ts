import { Router, type IRouter } from "express";
import { getCurrentGlobalMetrics } from "../automation/globalMetricsEngine";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

async function globalMetricsHandler(
  req: Parameters<typeof adminOnly>[0],
  res: Parameters<typeof adminOnly>[1],
) {
  try {
    const metrics = await getCurrentGlobalMetrics();
    res.json({ success: true, ...metrics });
  } catch (error) {
    req.log.error({ err: error }, "Global analytics query failed");
    res.status(503).json({
      success: false,
      error: "Global analytics are temporarily unavailable.",
    });
  }
}

router.get("/global-metrics", adminOnly, globalMetricsHandler);
router.get("/analytics", adminOnly, globalMetricsHandler);

export default router;