import { Router, type IRouter } from "express";
import { db, gmailWatchStateTable } from "@workspace/db";
import { validAutomationToken } from "../lib/automation-auth";

const router: IRouter = Router();

router.get("/gmail-watch-status", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (!validAutomationToken(req.header("authorization"))) {
    res.status(401).json({ error: "Invalid automation credential." });
    return;
  }
  try {
    const rows = await db.select().from(gmailWatchStateTable).limit(2);
    if (rows.length > 1) throw new Error("Ambiguous managed Gmail watch state.");
    const status = rows[0];
    if (!status) {
      res.json({ active: false });
      return;
    }
    const now = Date.now();
    const expires = status.watchExpiration.getTime();
    if (!Number.isFinite(expires)) throw new Error("Invalid watch expiration.");
    res.json({
      active: now < expires,
      expiresAt: status.watchExpiration.toISOString(),
      hoursRemaining: ((expires - now) / 3_600_000).toFixed(1),
      lastRenewedAt: status.lastRenewedAt?.toISOString() ?? null,
      historyId: status.lastHistoryId,
    });
  } catch {
    req.log.warn("Gmail watch status could not be read.");
    res.status(503).json({ error: "Gmail watch status is unavailable." });
  }
});

export default router;