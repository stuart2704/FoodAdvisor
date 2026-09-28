import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  CorrectPrivateContactRequestIdBody,
  CorrectPrivateContactRequestIdParams,
  CorrectPrivateContactRequestIdResponse,
} from "@workspace/api-zod";
import { adminOnly } from "../middleware/adminOnly";
import {
  correctBetterContactRequestId,
  getBetterContactBudgetForReview,
  getBetterContactJobForReview,
  listBetterContactJobsForReview,
  reconcileBetterContactJob,
  reserveBetterContactJob,
} from "../services/enrichment/betterContact";

const router: IRouter = Router();
const Domain = z.string().trim().toLowerCase().max(253).refine((value) =>
  !value.includes("://")
  && value.split(".").length >= 2
  && value.split(".").every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  && /^[a-z]{2,63}$/i.test(value.split(".").at(-1) ?? ""),
  "A company domain (not a URL) is required.",
);
const RequestBody = z.object({
  optIn: z.literal(true),
  maxCredits: z.literal(1),
  firstName: z.string().trim().min(2).max(100),
  lastName: z.string().trim().min(2).max(100),
  company: z.string().trim().min(2).max(200),
  companyDomain: Domain,
  // Human-entered provenance is mandatory. Restaurant name or page metadata
  // is never treated as evidence that a named person exists.
  personSource: z.string().trim().min(5).max(500),
}).strict();
const Params = z.object({ placeId: z.string().trim().min(1).max(512) });
const JobParams = z.object({ jobId: z.string().uuid() });
const ReconcileBody = z.object({
  confirmedIdentity: z.literal(true),
  providerRequestId: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  placeId: z.string().trim().min(1).max(512),
  firstName: z.string().trim().min(2).max(100),
  lastName: z.string().trim().min(2).max(100),
  companyDomain: Domain,
}).strict();
const CorrectionBody = CorrectPrivateContactRequestIdBody.extend({
  evidenceNote: z.string().trim().min(10).max(1000),
}).strict();

router.get("/private-contact-enrichments/budget", adminOnly, async (_req, res) => {
  res.json({ success: true, data: await getBetterContactBudgetForReview() });
});

router.get("/private-contact-enrichments", adminOnly, async (_req, res) => {
  res.json({ success: true, data: await listBetterContactJobsForReview() });
});

router.post("/restaurants/:placeId/private-contact-enrichments", adminOnly, async (req, res) => {
  const params = Params.safeParse(req.params);
  const body = RequestBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      success: false,
      error: "Explicit person, company, provenance, opt-in, and one-credit cap are required.",
    });
    return;
  }
  try {
    const result = await reserveBetterContactJob({
      placeId: params.data.placeId,
      firstName: body.data.firstName,
      lastName: body.data.lastName,
      company: body.data.company,
      companyDomain: body.data.companyDomain,
      personSource: body.data.personSource,
      maxCredits: body.data.maxCredits,
    });
    res.status(result.created ? 202 : 200).json({
      success: true,
      data: { id: result.job.id, status: result.job.status, created: result.created },
    });
  } catch (error) {
    req.log.warn({ err: error }, "Private contact enrichment reservation rejected");
    res.status(409).json({
      success: false,
      error: error instanceof Error ? error.message : "Enrichment could not be reserved.",
    });
  }
});

router.get("/private-contact-enrichments/:jobId", adminOnly, async (req, res) => {
  const parsed = JobParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid enrichment ID." });
    return;
  }
  const result = await getBetterContactJobForReview(parsed.data.jobId);
  if (!result) {
    res.status(404).json({ success: false, error: "Enrichment was not found." });
    return;
  }
  res.json({ success: true, data: result });
});

router.post("/private-contact-enrichments/:jobId/reconcile", adminOnly, async (req, res): Promise<void> => {
  const params = JobParams.safeParse(req.params);
  const body = ReconcileBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ success: false, error: "Provider ID and original person/company confirmation are required." });
    return;
  }
  try {
    const job = await reconcileBetterContactJob({ jobId: params.data.jobId, ...body.data });
    res.json({ success: true, data: { id: job.id, status: job.status } });
  } catch (error) {
    req.log.warn({ err: error }, "Manual contact reconciliation rejected");
    res.status(409).json({ success: false, error: error instanceof Error ? error.message : "Reconciliation failed." });
  }
});

router.post("/private-contact-enrichments/:jobId/correct-request-id", adminOnly, async (req, res): Promise<void> => {
  const params = CorrectPrivateContactRequestIdParams.safeParse(req.params);
  const body = CorrectionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ success: false, error: "Both IDs, an evidence note, and explicit confirmation are required." });
    return;
  }
  try {
    const job = await correctBetterContactRequestId({ jobId: params.data.jobId, ...body.data });
    res.json(CorrectPrivateContactRequestIdResponse.parse({
      success: true, data: { id: job.id, status: job.status, providerRequestId: job.providerRequestId },
    }));
  } catch (error) {
    req.log.warn({ err: error }, "Provider request ID correction rejected");
    res.status(409).json({ success: false, error: error instanceof Error ? error.message : "Correction failed." });
  }
});

export default router;