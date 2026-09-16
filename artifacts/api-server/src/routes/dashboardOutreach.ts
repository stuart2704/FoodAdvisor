import { db, outreachAuditTable, restaurantsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get("/outreach", adminOnly, async (req, res) => {
  const pagination = paginationSchema.safeParse(req.query);
  if (!pagination.success) {
    res.status(400).json({ success: false, error: "Invalid pagination." });
    return;
  }

  const { page, limit } = pagination.data;
  const offset = (page - 1) * limit;
  try {
    const sentCondition = eq(outreachAuditTable.event, "sent");
    const [[countRow], rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(outreachAuditTable)
        .where(sentCondition),
      db
        .select({
          id: outreachAuditTable.id,
          restaurant: restaurantsTable.name,
          email: restaurantsTable.publicBusinessEmail,
          sentAt: outreachAuditTable.createdAt,
          recipientDomain: outreachAuditTable.recipientDomain,
        })
        .from(outreachAuditTable)
        .innerJoin(
          restaurantsTable,
          eq(outreachAuditTable.placeId, restaurantsTable.placeId),
        )
        .where(sentCondition)
        .orderBy(desc(outreachAuditTable.createdAt), desc(outreachAuditTable.id))
        .limit(limit)
        .offset(offset),
    ]);

    res.json({
      success: true,
      page,
      limit,
      total: countRow?.count ?? 0,
      items: rows.map((row) => ({
        ...row,
        subject: null,
        aiSummary: null,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Dashboard outreach records failed");
    res.status(500).json({
      success: false,
      error: "Outreach records are unavailable.",
    });
  }
});

router.get("/outreach/summary", adminOnly, async (req, res) => {
  try {
    const eventCounts = await db
      .select({
        event: outreachAuditTable.event,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(outreachAuditTable)
      .groupBy(outreachAuditTable.event)
      .orderBy(outreachAuditTable.event);

    res.json({
      success: true,
      totalEvents: eventCounts.reduce((sum, row) => sum + row.count, 0),
      sent: eventCounts.find((row) => row.event === "sent")?.count ?? 0,
      failed: eventCounts.find((row) => row.event === "send_failed")?.count ?? 0,
      events: eventCounts,
    });
  } catch (error) {
    req.log.error({ err: error }, "Dashboard outreach summary failed");
    res.status(500).json({
      success: false,
      error: "Outreach summary is unavailable.",
    });
  }
});

export default router;