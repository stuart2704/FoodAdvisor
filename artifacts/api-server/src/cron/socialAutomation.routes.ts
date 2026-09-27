import { Router, type IRouter } from "express";
import { validAutomationToken } from "../lib/automation-auth";
import { logger } from "../lib/logger";
import { runSocialAutomationCycle } from "./socialAutomation";

export const socialAutomationRouter: IRouter = Router();

socialAutomationRouter.post("/social", async (req, res): Promise<void> => {
  if (!validAutomationToken(req.header("authorization"))) {
    res.status(401).json({ error: "Invalid automation credential." });
    return;
  }
  if (process.env.SOCIAL_AUTOMATION_ENABLED !== "true") {
    res.status(503).json({ error: "Social automation runner is disabled." });
    return;
  }
  try {
    const outcome = await runSocialAutomationCycle();
    res.json({ outcome });
  } catch (err) {
    logger.error({ err }, "Social automation cycle failed.");
    res.status(503).json({ error: "Social automation cycle failed." });
  }
});