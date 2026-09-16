import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  getClaimPage,
  submitClaim,
} from "../services/claimPageEngine";
import { claimPageEventsTable, db } from "@workspace/db";

const router: IRouter = Router();

const ClaimParams = z.object({
  id: z.string().trim().min(1).max(512),
});

const ClaimQuery = z.object({
  token: z.string().trim().min(40).max(2_048),
});

router.get("/claim/:id", async (req, res) => {
  const params = ClaimParams.safeParse(req.params);
  const query = ClaimQuery.safeParse(req.query);
  if (!params.success || !query.success) {
    res.status(403).json({ success: false, error: "Invalid claim link." });
    return;
  }
  try {
    const result = await getClaimPage(params.data.id, query.data.token);
    if (result.kind === "invalid_link") {
      res.status(403).json({ success: false, error: "Invalid claim link." });
      return;
    }
    if (result.kind === "not_found") {
      res.status(404).json({ success: false, error: "Restaurant not found." });
      return;
    }
    if (result.kind === "unavailable") {
      res.status(503).json({ success: false, error: "Claims are temporarily unavailable." });
      return;
    }
    try {
      await db.insert(claimPageEventsTable).values({
        placeId: result.data.id,
        eventType: "view",
        alreadyClaimed: result.data.claimed,
      });
    } catch (error) {
      req.log.warn({ err: error }, "Claim page metric could not be recorded");
    }
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.json({ success: true, data: result.data });
  } catch (error) {
    req.log.error({ err: error }, "Claim page query failed");
    res.status(503).json({ success: false, error: "Claims are temporarily unavailable." });
  }
});

router.post("/claim/:id", async (req, res) => {
  const params = ClaimParams.safeParse(req.params);
  const body = z
    .object({ claimToken: z.string().trim().min(40).max(2_048) })
    .passthrough()
    .safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ success: false, error: "Invalid claim submission." });
    return;
  }
  const { claimToken, ...form } = body.data;
  try {
    const result = await submitClaim(params.data.id, form, claimToken);
    if (!result.success) {
      const status =
        result.reason === "not_found"
          ? 404
          : result.reason === "claimed"
            ? 409
            : 403;
      res.status(status).json({
        success: false,
        error:
          result.reason === "claimed"
            ? "This restaurant has already been claimed."
            : result.reason === "not_found"
              ? "Restaurant not found."
              : "This claim link is invalid or has expired.",
      });
      return;
    }
    try {
      await db.insert(claimPageEventsTable).values({
        placeId: params.data.id,
        eventType: "completed",
        alreadyClaimed: false,
      });
    } catch (error) {
      req.log.warn({ err: error }, "Claim completion metric could not be recorded");
    }
    res.setHeader("Cache-Control", "no-store, private");
    res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "Claim submission failed");
    res.status(503).json({ success: false, error: "Claims are temporarily unavailable." });
  }
});

export default router;