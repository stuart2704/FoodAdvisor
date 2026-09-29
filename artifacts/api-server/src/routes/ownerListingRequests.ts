import { db, ownerListingRequestsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();
const body = z.object({
  kind: z.enum(["no_invitation", "new_listing"]),
  restaurantName: z.string().trim().min(2).max(160),
  city: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(300),
  contactName: z.string().trim().min(2).max(120),
  businessEmail: z.string().email().max(254),
  website: z.union([z.string().url().max(400), z.literal("")]).optional(),
  note: z.string().trim().max(1000).optional(),
  // Honeypot: reject automated submissions without storing them.
  companyFax: z.string().max(0).optional(),
}).strict();

router.post("/owner/listing-requests", rateLimit({
  windowMs: 60 * 60_000, limit: 4, standardHeaders: "draft-8", legacyHeaders: false,
  message: { success: false, error: "Too many requests. Please try later." },
}), async (req, res): Promise<void> => {
  const input = body.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ success: false, error: "Check the restaurant and contact details." });
    return;
  }
  const { companyFax: _unused, website, ...details } = input.data;
  try {
    await db.insert(ownerListingRequestsTable).values({ ...details, website: website || null });
    // Requests are review-only: no claim token, publication, enrichment or outreach.
    res.status(202).json({ success: true, message: "Request received for manual review." });
  } catch (error) {
    req.log.error({ err: error }, "Owner listing request failed");
    res.status(503).json({ success: false, error: "Request could not be saved. Please try again later." });
  }
});

router.get("/dashboard/owner/listing-requests", adminOnly, async (req, res): Promise<void> => {
  try {
    const requests = await db.select().from(ownerListingRequestsTable)
      .orderBy(desc(ownerListingRequestsTable.createdAt)).limit(100);
    res.json({ success: true, requests });
  } catch (error) {
    req.log.error({ err: error }, "Owner listing requests unavailable");
    res.status(503).json({ success: false, error: "Requests are unavailable." });
  }
});

export default router;