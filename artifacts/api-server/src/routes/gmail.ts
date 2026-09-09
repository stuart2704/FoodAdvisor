import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { SyncGmailRepliesResponse } from "@workspace/api-zod";
import { pollGmailReplies } from "../services/gmail/gmailWebhookHandler";

const router: IRouter = Router();

function validAutomationToken(header: string | undefined): boolean {
  const expected = process.env.AUTOMATION_TOKEN;
  const supplied = header?.match(/^Bearer (.+)$/i)?.[1];
  if (!expected || expected.length < 32 || !supplied) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

router.post("/gmail/sync", async (req, res): Promise<void> => {
  if (!validAutomationToken(req.header("authorization"))) {
    res.status(401).json({ error: "Invalid automation credential." });
    return;
  }
  try {
    const result = await pollGmailReplies();
    res.json(SyncGmailRepliesResponse.parse(result));
  } catch (error) {
    req.log.warn({ err: error }, "Gmail reply polling did not run");
    res.status(503).json({ error: "Gmail reply polling could not start." });
  }
});

export default router;