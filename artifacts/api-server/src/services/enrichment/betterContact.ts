import { createHash, randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  betterContactAuditTable,
  betterContactBudgetsTable,
  betterContactJobsTable,
  betterContactPrivateContactsTable,
  db,
  restaurantsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";

const CONNECTOR = "bettercontact";
const RESERVED_CREDITS = 1;
const MAX_POLL_ATTEMPTS = 40;
const REQUEST_LIFETIME_MS = 6 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 15_000;
const TERMINAL = ["completed", "failed", "submit_ambiguous", "timed_out"] as const;

export interface BetterContactInput {
  placeId: string;
  firstName: string;
  lastName: string;
  company: string;
  companyDomain: string;
  personSource: string;
  maxCredits: 1;
}

type ProviderRecord = Record<string, unknown>;

function configuredMonthlyCap(): number | null {
  if (process.env.BETTERCONTACT_ENABLED !== "true") return null;
  const cap = Number(process.env.BETTERCONTACT_MONTHLY_CREDIT_CAP);
  return Number.isSafeInteger(cap) && cap > 0 ? cap : null;
}

function period(now: Date): string {
  return now.toISOString().slice(0, 7);
}

function normal(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function betterContactContextHash(input: BetterContactInput): string {
  return createHash("sha256").update(JSON.stringify([
    normal(input.firstName),
    normal(input.lastName),
    normal(input.company),
    normal(input.companyDomain),
  ])).digest("hex");
}

function safeDetail(value: unknown): string {
  return value instanceof Error ? value.message.slice(0, 300) : "Provider request failed.";
}

function isDefinitiveSubmissionRejection(
  status: number,
  body: ProviderRecord | null,
): boolean {
  // BetterContact documents these POST responses as requests that were not
  // accepted. A status alone is insufficient: proxies can manufacture 4xx
  // responses, so require the documented JSON error envelope as well.
  if (![400, 401, 402, 422].includes(status) || !body || body.success !== false) {
    return false;
  }
  return (typeof body.error === "string" && body.error.trim().length > 0)
    || (typeof body.message === "string" && body.message.trim().length > 0);
}

async function audit(
  jobId: string,
  placeId: string,
  event: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(betterContactAuditTable).values({ jobId, placeId, event, detail });
}

export async function reserveBetterContactJob(input: BetterContactInput) {
  const cap = configuredMonthlyCap();
  if (cap === null || input.maxCredits !== RESERVED_CREDITS) {
    throw new Error("BetterContact is disabled or its explicit credit cap is invalid.");
  }
  const now = new Date();
  const budgetPeriod = period(now);
  const contextHash = betterContactContextHash(input);
  return db.transaction(async (tx) => {
    const [restaurant] = await tx.select({ placeId: restaurantsTable.placeId })
      .from(restaurantsTable).where(eq(restaurantsTable.placeId, input.placeId)).limit(1);
    if (!restaurant) throw new Error("Restaurant was not found.");

    const [existing] = await tx.select().from(betterContactJobsTable).where(and(
      eq(betterContactJobsTable.placeId, input.placeId),
      eq(betterContactJobsTable.contextHash, contextHash),
    )).limit(1);
    if (existing) return { job: existing, created: false };

    await tx.insert(betterContactBudgetsTable).values({
      period: budgetPeriod,
      creditCap: cap,
    }).onConflictDoNothing();
    const [budget] = await tx.update(betterContactBudgetsTable).set({
      reservedCredits: sql`${betterContactBudgetsTable.reservedCredits} + ${RESERVED_CREDITS}`,
      updatedAt: now,
    }).where(and(
      eq(betterContactBudgetsTable.period, budgetPeriod),
      // A lower newly configured cap takes effect immediately; a higher one is
      // not silently adopted for an already-created period.
      lte(betterContactBudgetsTable.creditCap, cap),
      sql`${betterContactBudgetsTable.reservedCredits} + ${betterContactBudgetsTable.consumedCredits} + ${RESERVED_CREDITS} <= least(${betterContactBudgetsTable.creditCap}, ${cap})`,
    )).returning({ period: betterContactBudgetsTable.period });
    if (!budget) throw new Error("BetterContact monthly credit budget is exhausted.");

    const id = randomUUID();
    const [job] = await tx.insert(betterContactJobsTable).values({
      id,
      placeId: input.placeId,
      contextHash,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      company: input.company.trim(),
      companyDomain: normal(input.companyDomain),
      personSource: input.personSource.trim(),
      budgetPeriod,
      reservedCredits: RESERVED_CREDITS,
      status: "reserved",
      nextPollAt: now,
      deadlineAt: new Date(now.getTime() + REQUEST_LIFETIME_MS),
    }).returning();
    await tx.insert(betterContactAuditTable).values({
      jobId: id,
      placeId: input.placeId,
      event: "budget_reserved",
      detail: { credits: RESERVED_CREDITS, period: budgetPeriod },
    });
    return { job: job!, created: true };
  });
}

async function connectorResponse(path: string, options?: {
  method: "POST";
  body: string;
  headers: { "Content-Type": string };
}): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("BetterContact request timed out.")), REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      new ReplitConnectors().proxy(CONNECTOR, path, options),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function providerJson(response: Response): Promise<ProviderRecord | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), REQUEST_TIMEOUT_MS);
  });
  try {
    const value = await Promise.race([
      response.json().catch(() => null),
      timeout,
    ]);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as ProviderRecord
      : null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function submit(job: typeof betterContactJobsTable.$inferSelect): Promise<void> {
  const started = new Date();
  const [claimed] = await db.update(betterContactJobsTable).set({
    status: "submitting",
    postStartedAt: started,
    updatedAt: started,
  }).where(and(
    eq(betterContactJobsTable.id, job.id),
    eq(betterContactJobsTable.status, "reserved"),
  )).returning();
  if (!claimed) return;

  let response: Response;
  try {
    response = await connectorResponse("/api/v2/async", {
      method: "POST",
      body: JSON.stringify({
        data: [{
          first_name: job.firstName,
          last_name: job.lastName,
          company: job.company,
          company_domain: job.companyDomain,
          custom_fields: {
            context_id: job.contextHash,
            restaurant_id: job.placeId,
          },
        }],
        enrich_email_address: true,
        enrich_phone_number: false,
        enrich_profile: false,
        verify_catch_all: true,
      }),
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    // The POST may have reached the provider. Keep the reservation and never
    // resubmit this context automatically.
    await db.update(betterContactJobsTable).set({
      status: "submit_ambiguous",
      lastError: safeDetail(error),
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(betterContactJobsTable.id, job.id));
    await audit(job.id, job.placeId, "submit_ambiguous");
    return;
  }

  // A 201 with an unreadable or timed-out body is ambiguous.
  const body = await providerJson(response);
  if (response.status !== 201 && isDefinitiveSubmissionRejection(response.status, body)) {
    await db.transaction(async (tx) => {
      const [failed] = await tx.update(betterContactJobsTable).set({
        status: "failed",
        lastError: `Provider rejected submission (${response.status}).`,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(betterContactJobsTable.id, job.id),
        eq(betterContactJobsTable.status, "submitting"),
      )).returning({ id: betterContactJobsTable.id });
      if (!failed) return;
      await tx.update(betterContactBudgetsTable).set({
        reservedCredits: sql`greatest(0, ${betterContactBudgetsTable.reservedCredits} - ${job.reservedCredits})`,
        updatedAt: new Date(),
      }).where(eq(betterContactBudgetsTable.period, job.budgetPeriod));
      await tx.insert(betterContactAuditTable).values({
        jobId: job.id,
        placeId: job.placeId,
        event: "submit_rejected",
        detail: { status: response.status },
      });
    });
    return;
  }
  if (response.status !== 201) {
    await db.update(betterContactJobsTable).set({
      status: "submit_ambiguous",
      lastError: `Provider submission outcome was uncertain (${response.status}).`,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(betterContactJobsTable.id, job.id),
      eq(betterContactJobsTable.status, "submitting"),
    ));
    await audit(job.id, job.placeId, "submit_ambiguous", { status: response.status });
    return;
  }
  const providerId = body?.success === true && typeof body.id === "string" && body.id
    ? body.id : null;
  if (!providerId) {
    await db.update(betterContactJobsTable).set({
      status: "submit_ambiguous",
      lastError: "Provider acknowledgement was invalid.",
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(betterContactJobsTable.id, job.id));
    await audit(job.id, job.placeId, "submit_ambiguous");
    return;
  }
  await db.update(betterContactJobsTable).set({
    status: "polling",
    providerRequestId: providerId,
    nextPollAt: new Date(Date.now() + 15_000),
    updatedAt: new Date(),
  }).where(eq(betterContactJobsTable.id, job.id));
  await audit(job.id, job.placeId, "submitted");
}

function customField(record: ProviderRecord, name: string): string | null {
  if (!Array.isArray(record.custom_fields)) return null;
  const field = record.custom_fields.find((item) =>
    item && typeof item === "object"
    && (item as ProviderRecord).name === name
    && typeof (item as ProviderRecord).value === "string");
  return field ? (field as ProviderRecord).value as string : null;
}

export function exactBetterContactMatch(
  job: Pick<typeof betterContactJobsTable.$inferSelect,
    "firstName" | "lastName" | "contextHash">,
  record: ProviderRecord,
): boolean {
  return normal(String(record.contact_first_name ?? "")) === normal(job.firstName)
    && normal(String(record.contact_last_name ?? "")) === normal(job.lastName)
    && customField(record, "context_id") === job.contextHash;
}

function reconciledCredits(
  job: typeof betterContactJobsTable.$inferSelect,
  consumedRaw: unknown,
): number {
  const consumed = Number(consumedRaw);
  return Number.isInteger(consumed) && consumed >= 0
    ? Math.min(consumed, job.reservedCredits)
    : job.reservedCredits; // unknown accounting fails closed
}

async function poll(job: typeof betterContactJobsTable.$inferSelect): Promise<void> {
  const providerRequestId = job.providerRequestId;
  if (!providerRequestId) return;
  const [claimed] = await db.update(betterContactJobsTable).set({
    status: "polling_active",
    updatedAt: new Date(),
  }).where(and(
    eq(betterContactJobsTable.id, job.id),
    eq(betterContactJobsTable.status, job.status),
  )).returning();
  if (!claimed) return;
  job = claimed;
  let response: Response;
  try {
    response = await connectorResponse(`/api/v2/async/${encodeURIComponent(providerRequestId)}`);
  } catch {
    response = new Response(null, { status: 500 });
  }
  const body = await providerJson(response) ?? {};
  const attempts = job.pollAttempts + 1;
  const now = new Date();
  if (body.status !== "terminated") {
    if (attempts >= MAX_POLL_ATTEMPTS || now >= job.deadlineAt) {
      // Provider may still finish, so reservation becomes consumed rather than
      // being made available for another potentially duplicate request.
      await db.transaction(async (tx) => {
        const [timedOut] = await tx.update(betterContactJobsTable).set({
          status: "timed_out", pollAttempts: attempts, completedAt: now,
          lastError: "Polling limit reached.", updatedAt: now,
        }).where(and(
          eq(betterContactJobsTable.id, job.id),
          eq(betterContactJobsTable.status, "polling_active"),
        )).returning({ id: betterContactJobsTable.id });
        if (!timedOut) return;
        await tx.update(betterContactBudgetsTable).set({
          reservedCredits: sql`greatest(0, ${betterContactBudgetsTable.reservedCredits} - ${job.reservedCredits})`,
          consumedCredits: sql`${betterContactBudgetsTable.consumedCredits} + ${job.reservedCredits}`,
          updatedAt: now,
        }).where(eq(betterContactBudgetsTable.period, job.budgetPeriod));
        await tx.insert(betterContactAuditTable).values({
          jobId: job.id,
          placeId: job.placeId,
          event: "poll_timed_out",
          detail: { attempts },
        });
      });
      return;
    }
    await db.update(betterContactJobsTable).set({
      status: body.status === "on_hold" ? "on_hold" : "polling",
      pollAttempts: attempts,
      nextPollAt: new Date(now.getTime() + Math.min(5 * 60_000, 15_000 * 2 ** Math.min(attempts, 5))),
      updatedAt: now,
    }).where(eq(betterContactJobsTable.id, job.id));
    return;
  }

  const data = Array.isArray(body.data) ? body.data.filter(
    (item): item is ProviderRecord => !!item && typeof item === "object" && !Array.isArray(item),
  ) : [];
  const accepted = data.find((record) =>
    record.enriched === true
    && record.contact_email_address_status === "deliverable"
    && typeof record.contact_email_address === "string"
    && exactBetterContactMatch(job, record));
  const consumed = reconciledCredits(job, body.credits_consumed);
  await db.transaction(async (tx) => {
    const [completed] = await tx.update(betterContactJobsTable).set({
      status: "completed",
      pollAttempts: attempts,
      completedAt: now,
      updatedAt: now,
    }).where(and(
      eq(betterContactJobsTable.id, job.id),
      eq(betterContactJobsTable.status, "polling_active"),
    )).returning({ id: betterContactJobsTable.id });
    if (!completed) return;
    await tx.update(betterContactBudgetsTable).set({
      reservedCredits: sql`greatest(0, ${betterContactBudgetsTable.reservedCredits} - ${job.reservedCredits})`,
      consumedCredits: sql`${betterContactBudgetsTable.consumedCredits} + ${consumed}`,
      updatedAt: now,
    }).where(eq(betterContactBudgetsTable.period, job.budgetPeriod));
    if (accepted) {
      await tx.insert(betterContactPrivateContactsTable).values({
        jobId: job.id,
        placeId: job.placeId,
        firstName: job.firstName,
        lastName: job.lastName,
        email: accepted.contact_email_address as string,
        providerEmailStatus: "deliverable",
        reviewOnly: true,
        outreachEligible: false,
      }).onConflictDoNothing();
    }
    await tx.insert(betterContactAuditTable).values({
      jobId: job.id,
      placeId: job.placeId,
      event: accepted ? "private_contact_stored" : "terminated_without_accepted_contact",
      detail: { creditsConsumed: consumed, exactIdentityMatch: Boolean(accepted) },
    });
  });
}

/** Restart-safe worker. Imports and startup never submit; only scheduled calls do. */
export async function processBetterContactJobs(limit = 10): Promise<number> {
  if (configuredMonthlyCap() === null) return 0;
  const now = new Date();
  // A process dying after claiming a POST leaves "submitting". It is ambiguous
  // by design and is never put back into the submission queue.
  const abandonedSubmissions = await db.update(betterContactJobsTable).set({
    status: "submit_ambiguous",
    lastError: "Submission outcome was not durably acknowledged.",
    completedAt: now,
    updatedAt: now,
  }).where(and(
    eq(betterContactJobsTable.status, "submitting"),
    lte(betterContactJobsTable.postStartedAt, new Date(now.getTime() - REQUEST_TIMEOUT_MS)),
  )).returning({
    id: betterContactJobsTable.id,
    placeId: betterContactJobsTable.placeId,
  });
  for (const abandoned of abandonedSubmissions) {
    await audit(abandoned.id, abandoned.placeId, "submit_ambiguous_recovered");
  }
  // GET is idempotent, so interrupted polls can safely be recovered.
  await db.update(betterContactJobsTable).set({
    status: "polling",
    nextPollAt: now,
    updatedAt: now,
  }).where(and(
    eq(betterContactJobsTable.status, "polling_active"),
    lte(betterContactJobsTable.updatedAt, new Date(now.getTime() - REQUEST_TIMEOUT_MS)),
  ));
  const jobs = await db.select().from(betterContactJobsTable).where(and(
    inArray(betterContactJobsTable.status, ["reserved", "polling", "on_hold"]),
    lte(betterContactJobsTable.nextPollAt, now),
  )).limit(Math.max(1, Math.min(limit, 50)));
  for (const job of jobs) {
    if (job.status === "reserved") await submit(job);
    else await poll(job);
  }
  return jobs.length;
}

export async function getBetterContactJobForReview(jobId: string) {
  const [job] = await db.select().from(betterContactJobsTable)
    .where(eq(betterContactJobsTable.id, jobId)).limit(1);
  if (!job) return null;
  const [contact] = await db.select().from(betterContactPrivateContactsTable)
    .where(eq(betterContactPrivateContactsTable.jobId, jobId)).limit(1);
  return { job, privateReviewContact: contact ?? null };
}

/** Admin-only route callers must guard these private budget and request summaries. */
export async function getBetterContactBudgetForReview() {
  const configuredCap = configuredMonthlyCap();
  const currentPeriod = period(new Date());
  const [budget] = await db.select().from(betterContactBudgetsTable)
    .where(eq(betterContactBudgetsTable.period, currentPeriod)).limit(1);
  const effectiveCap = configuredCap === null ? null
    : Math.min(configuredCap, budget?.creditCap ?? configuredCap);
  return {
    enabled: configuredCap !== null,
    period: currentPeriod,
    configuredCap,
    effectiveCap,
    reservedCredits: budget?.reservedCredits ?? 0,
    consumedCredits: budget?.consumedCredits ?? 0,
    availableCredits: effectiveCap === null ? null
      : Math.max(0, effectiveCap - (budget?.reservedCredits ?? 0) - (budget?.consumedCredits ?? 0)),
  };
}

export async function listBetterContactJobsForReview() {
  return db.select({
    id: betterContactJobsTable.id,
    placeId: betterContactJobsTable.placeId,
    firstName: betterContactJobsTable.firstName,
    lastName: betterContactJobsTable.lastName,
    company: betterContactJobsTable.company,
    status: betterContactJobsTable.status,
    createdAt: betterContactJobsTable.createdAt,
  }).from(betterContactJobsTable)
    .orderBy(desc(betterContactJobsTable.createdAt)).limit(50);
}

export { TERMINAL };