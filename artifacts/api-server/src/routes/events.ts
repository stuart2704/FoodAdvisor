import { Router, type IRouter } from "express";
import { validAutomationToken } from "../lib/automation-auth";
import { getEvents } from "../utils/eventLog";

const router: IRouter = Router();

router.get("/events", (req, res): void => {
  res.setHeader("Cache-Control", "no-store");
  if (!validAutomationToken(req.header("authorization"))) {
    res.status(401).json({ error: "Invalid automation credential." });
    return;
  }
  res.json(getEvents());
});

export default router;