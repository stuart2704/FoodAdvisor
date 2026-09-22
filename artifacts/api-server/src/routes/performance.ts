import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";
import { getEnginePerformanceMetrics } from "../services/operationalLog";

const router: IRouter = Router();

router.get("/", adminOnly, async (req, res) => {
  try {
    res.json(await getEnginePerformanceMetrics());
  } catch (error) {
    req.log.error({ err: error }, "Engine performance metrics failed.");
    res.status(503).json({
      success: false,
      error: "Engine performance metrics are unavailable.",
    });
  }
});

export default router;