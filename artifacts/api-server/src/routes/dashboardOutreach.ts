import { db, outreachAuditTable, restaurantsTable } from "@workspace/db";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { adminOnly } from "../middleware/adminOnly";
import {
  checkBusinessEmailFromWebsite,
  isResearchStatus,
} from "../services/enrichment/businessEmailResearch";

const router: IRouter = Router();

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const researchPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(["all", "no_business_email", "extraction_failed"]).default("all"),
}).strict();

const researchStatuses = ["no_business_email", "extraction_failed"] as const;
const placeIdSchema = z.string().min(1).max(255).regex(/^[A-Za-z0-9:_-]+$/);
const emptyBodySchema = z.object({}).strict();

router.get("/outreach/research", adminOnly, async (req, res) => {
  const parsed = researchPaginationSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid research filters." });
    return;
  }

  const { page, limit, status } = parsed.data;
  const selectedStatus = status === "all" ? undefined : status;
  const condition = selectedStatus
    ? eq(restaurantsTable.outreachStatus, selectedStatus)
    : inArray(restaurantsTable.outreachStatus, [...researchStatuses]);
  try {
    const [[totalRow], summaryRows, rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(restaurantsTable)
        .where(condition),
      db.select({
        status: restaurantsTable.outreachStatus,
        count: sql<number>`count(*)`.mapWith(Number),
      })
        .from(restaurantsTable)
        .where(inArray(restaurantsTable.outreachStatus, [...researchStatuses]))
        .groupBy(restaurantsTable.outreachStatus),
      db.select({
        placeId: restaurantsTable.placeId,
        name: restaurantsTable.name,
        city: restaurantsTable.city,
        website: restaurantsTable.website,
        status: restaurantsTable.outreachStatus,
        reason: restaurantsTable.outreachFailure,
        checkedAt: restaurantsTable.enrichedAt,
      })
        .from(restaurantsTable)
        .where(condition)
        .orderBy(asc(restaurantsTable.enrichedAt), asc(restaurantsTable.importedAt))
        .limit(limit)
        .offset((page - 1) * limit),
    ]);

    res.json({
      success: true,
      page,
      limit,
      total: totalRow?.count ?? 0,
      summary: {
        noBusinessEmail: summaryRows.find((row) => row.status === "no_business_email")?.count ?? 0,
        extractionFailed: summaryRows.find((row) => row.status === "extraction_failed")?.count ?? 0,
      },
      items: rows.map((row) => ({
        ...row,
        reason: row.reason ?? "",
        checkedAt: row.checkedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Dashboard outreach research failed");
    res.status(500).json({ success: false, error: "Outreach research is unavailable." });
  }
});

router.post("/outreach/research/:placeId/recheck", adminOnly, async (req, res) => {
  const placeId = placeIdSchema.safeParse(req.params.placeId);
  const body = emptyBodySchema.safeParse(req.body ?? {});
  if (!placeId.success || !body.success) {
    res.status(400).json({ success: false, error: "Invalid research recheck request." });
    return;
  }

  try {
    const [restaurant] = await db
      .select({
        status: restaurantsTable.outreachStatus,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, placeId.data))
      .limit(1);
    if (!restaurant) {
      res.status(404).json({ success: false, error: "Restaurant was not found." });
      return;
    }
    if (!isResearchStatus(restaurant.status)) {
      res.status(409).json({
        success: false,
        error: "Restaurant is not awaiting email research.",
      });
      return;
    }

    const result = await checkBusinessEmailFromWebsite(placeId.data, {
      requireResearchStatus: true,
    });
    if (!result) {
      res.status(404).json({ success: false, error: "Restaurant was not found." });
      return;
    }
    if (result.busy) {
      res.status(409).json({ success: false, error: "A website check is already in progress." });
      return;
    }
    if (result.outcome !== "checked") {
      res.status(409).json({
        success: false,
        error: "Research was skipped because outreach or claim state changed.",
      });
      return;
    }
    res.json({
      success: true,
      status: result.status,
      emailFound: result.emailFound,
    });
  } catch (error) {
    req.log.error({ err: error }, "Dashboard outreach research recheck failed");
    res.status(500).json({ success: false, error: "Website recheck failed." });
  }
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