import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";
import { orchestrationSummary } from "../external/orchestrationSummary";

const router: IRouter = Router();

router.get("/summary", adminOnly, async (req, res) => {
  try {
    const summary = await orchestrationSummary();
    res.setHeader("Cache-Control", "no-store");
    res.json(summary);
  } catch (error) {
    req.log.error({ err: error }, "Orchestration summary failed");
    res.status(503).json({ error: "Orchestration summary is temporarily unavailable." });
  }
});

export default router;