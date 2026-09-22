import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";
import { getErrorMetrics } from "../services/errorMetrics";

const router: IRouter = Router();

router.get("/", adminOnly, async (req, res) => {
  try {
    res.json(await getErrorMetrics());
  } catch (error) {
    req.log.error({ err: error }, "Error metrics query failed.");
    res.status(503).json({
      success: false,
      error: "Error metrics are unavailable.",
    });
  }
});

export default router;