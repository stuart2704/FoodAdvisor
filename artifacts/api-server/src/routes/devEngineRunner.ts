import { Router, type IRouter } from "express";
import { runEngineCycle } from "../automation/loopRunner";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

router.post("/run-engines", adminOnly, async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(403).json({
      error: "Engine runner is disabled in production.",
    });
    return;
  }

  try {
    await runEngineCycle();
    res.json({ status: "ok", message: "Engine cycle executed." });
  } catch (error) {
    req.log.error({ err: error }, "Development engine cycle failed");
    res.status(500).json({ error: "Engine cycle failed." });
  }
});

export default router;