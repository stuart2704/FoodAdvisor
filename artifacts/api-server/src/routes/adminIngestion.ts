import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";
import { getIngestionHealth } from "../external/ingestionHealth";

const router: IRouter = Router();

router.get("/admin/ingestion/health", adminOnly, async (req, res) => {
  try {
    const health = await getIngestionHealth();
    res.json(health);
  } catch (error) {
    req.log.error({ err: error }, "Ingestion health query failed");
    res.status(503).json({
      success: false,
      error: "Ingestion health is temporarily unavailable.",
    });
  }
});

export default router;