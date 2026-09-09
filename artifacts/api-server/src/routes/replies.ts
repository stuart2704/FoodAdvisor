import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  ClassifyIncomingReplyBody,
  ClassifyIncomingReplyResponse,
} from "@workspace/api-zod";
import { db, outreachAuditTable, restaurantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { classifyReply } from "../services/replyClassifier/classifyReply";

const router: IRouter = Router();

function validAutomationToken(header: string | undefined): boolean {
  const expected = process.env.AUTOMATION_TOKEN;
  const supplied = header?.match(/^Bearer (.+)$/i)?.[1];
  if (!expected || expected.length < 32 || !supplied) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

function senderDomain(from: string | undefined): string | undefined {
  if (!from) return undefined;
  const match = from.match(/@([a-z0-9.-]+\.[a-z]{2,})(?:>|\s|$)/i);
  return match?.[1]?.toLowerCase();
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

  const classification = classifyReply(parsed.data.body);
  const suppress =
    classification.category === "unsubscribe" ||
    classification.category === "wrong_contact" ||
    classification.category === "not_interested";
  const outreachStatus =
    classification.category === "unknown" ? "replied" : classification.category;

  const found = await db.transaction(async (tx) => {
    const [restaurant] = await tx
      .update(restaurantsTable)
      .set(
        suppress
          ? {
              outreachStatus: "suppressed",
              suppressedAt: new Date(),
              suppressionReason: classification.category,
              publicBusinessEmail: null,
            }
          : { outreachStatus },
      )
      .where(eq(restaurantsTable.placeId, parsed.data.placeId))
      .returning({ placeId: restaurantsTable.placeId });
    if (!restaurant) return false;
    await tx.insert(outreachAuditTable).values({
      placeId: restaurant.placeId,
      event: "reply_classified",
      recipientDomain: senderDomain(parsed.data.from),
      detail: JSON.stringify({
        category: classification.category,
        confidence: classification.confidence,
      }),
    });
    return true;
  });

  if (!found) {
    res.status(404).json({ error: "Restaurant not found." });
    return;
  }
  res.json(ClassifyIncomingReplyResponse.parse(classification));
});

export default router;