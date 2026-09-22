import { Router, type IRouter } from "express";
import { z } from "zod";
import { classifyError } from "../errors/errorService";
import { validAutomationToken } from "../lib/automation-auth";
import { recordHeartbeat } from "../services/engineHeartbeat";
import { logEvent } from "../utils/eventLog";

const router: IRouter = Router();

const currentEventSchema = z
  .object({
    type: z.string().trim().min(1).max(32),
    message: z.string().trim().min(1).max(1_000),
    category: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const legacyEventSchema = z
  .object({
    engine: z.string().trim().min(1).max(32),
    severity: z.string().trim().min(1).max(64).default("info"),
    summary: z.string().trim().min(1).max(1_000),
    metadata: z
      .record(z.string(), z.unknown())
      .refine((metadata) => Object.keys(metadata).length === 0)
      .optional(),
  })
  .strict();

router.post("/", async (req, res) => {
  if (!validAutomationToken(req.header("authorization"))) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }
  const parsed = z.union([currentEventSchema, legacyEventSchema]).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid operational event." });
    return;
  }
  try {
    if ("engine" in parsed.data) {
      const tags =
        parsed.data.severity.toLowerCase() === "error"
          ? [classifyError(parsed.data)]
          : [];
      logEvent(
        parsed.data.engine,
        parsed.data.summary,
        parsed.data.severity,
        tags,
      );
      if (parsed.data.summary.trim().toLowerCase() === "heartbeat") {
        await recordHeartbeat(parsed.data.engine);
      }
    } else {
      const tags =
        parsed.data.category?.toLowerCase() === "error"
          ? [classifyError(parsed.data)]
          : [];
      logEvent(
        parsed.data.type,
        parsed.data.message,
        parsed.data.category,
        tags,
      );
      if (parsed.data.message.trim().toLowerCase() === "heartbeat") {
        await recordHeartbeat(parsed.data.type);
      }
    }
    res.status(202).json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "Internal operational event ingestion failed.");
    res.status(503).json({
      success: false,
      error: "Operational event ingestion is unavailable.",
    });
  }
});

export default router;