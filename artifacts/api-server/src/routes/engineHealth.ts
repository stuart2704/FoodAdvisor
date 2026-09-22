import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";
import {
  getEngineStatuses,
  recordHeartbeat,
  type EngineStatus,
} from "../services/engineHeartbeat";

const router: IRouter = Router();
const engines = ["ai", "automation", "queue", "api", "database"] as const;

router.get("/", adminOnly, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await recordHeartbeat("api");
    await recordHeartbeat("database");
    const statuses = await getEngineStatuses();
    const response = Object.fromEntries(
      engines.map((engine) => [
        engine,
        { status: statuses[engine] ?? ("offline" satisfies EngineStatus) },
      ]),
    );
    res.json(response);
  } catch (error) {
    req.log.error({ err: error }, "Engine heartbeat status check failed.");
    res.status(503).json({
      success: false,
      error: "Engine heartbeat status is unavailable.",
    });
  }
});

export default router;