import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";
import { getOperationalMetrics } from "../services/operationalLog";

const router: IRouter = Router();

router.get("/", adminOnly, async (_req, res) => {
  try {
    res.json(await getOperationalMetrics());
  } catch {
    res.status(503).json({
      success: false,
      error: "Operational metrics are unavailable.",
    });
  }
});

export default router;