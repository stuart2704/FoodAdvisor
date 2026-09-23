import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  ClassifyIncomingReplyBody,
  ClassifyIncomingReplyResponse,
  PollGmailRepliesResponse,
  PollInstantlyRepliesResponse,
} from "@workspace/api-zod";
import { processIncomingReply } from "../services/replyClassifier/processIncomingReply";
import { pollGmailReplies } from "../services/gmail/gmailWebhookHandler";
import { pollInstantlyReplies } from "../services/instantly/instantlyService";

const router: IRouter = Router();

function validAutomationToken(header: string | undefined): boolean {
  const expected = process.env.AUTOMATION_TOKEN;
  const supplied = header?.match(/^Bearer (.+)$/i)?.[1];
  if (!expected || expected.length < 32 || !supplied) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

router.post("/replies/incoming", async (req, res): Promise<void> => {
  if (!validAutomationToken(req.header("authorization"))) {
    res.status(401).json({ error: "Invalid automation credential." });
    return;
  }
  const parsed = ClassifyIncomingReplyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid place ID and bounded reply body are required." });
    return;
  }

  const result = await processIncomingReply(parsed.data);
  if (result.status === "not_found") {
    res.status(404).json({ error: "Restaurant not found." });
    return;
  }
  if (result.status !== "processed") {
    res.status(409).json({ error: "Reply was already processed." });
    return;
  }
  res.json(ClassifyIncomingReplyResponse.parse(result.classification));
});

// Pulling is explicit and separately feature-flagged. Incoming records are
// matched only through locally stored Instantly campaign ownership records.
router.post("/automation/instantly/replies", async (req, res): Promise<void> => {
  if (!validAutomationToken(req.header("authorization"))) {
    res.status(401).json({ error: "Invalid automation credential." });
    return;
  }
  try {
    res.json(PollInstantlyRepliesResponse.parse(await pollInstantlyReplies()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instantly reply polling failed.";
    req.log.warn("Instantly reply polling did not run");
    res.status(503).json({ error: message });
  }
});

// Gmail polling derives restaurant ownership and reply contents exclusively
// from durable outbound-thread mappings and Gmail itself.
router.post("/automation/gmail/replies", async (req, res): Promise<void> => {
  if (!validAutomationToken(req.header("authorization"))) {
    res.status(401).json({ error: "Invalid automation credential." });
    return;
  }
  try {
    res.json(PollGmailRepliesResponse.parse(await pollGmailReplies()));
  } catch {
    req.log.warn("Gmail reply polling did not run");
    res.status(503).json({ error: "Gmail reply polling is temporarily unavailable." });
  }
});

export default router;