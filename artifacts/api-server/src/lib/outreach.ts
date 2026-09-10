import { createHash, randomBytes } from "node:crypto";
import {
  db,
  gmailOutreachThreadsTable,
  gmailHistoryMessagesTable,
  outreachAuditTable,
  pool,
  restaurantsTable,
} from "@workspace/db";
import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { enrichRestaurant } from "../services/enrichment/enrichRestaurant";
import { validateEmail } from "../services/enrichment/validateEmail";
import { assertPublicHttpsUrl } from "./public-url";
import { generateOutreachFor } from "../outreach/messageGenerator";
import {
  buildFollowupMessage,
  isFollowupDue,
  type FollowupStep,
} from "../outreach/followupPolicy";
import {
  assertInstantlyCampaignConfiguration,
  drainInstantlyCampaignCancellations,
  reconcileInstantlyInboxFully,
  reconcileInstantlySentMessages,
  sendInstantlyEmail,
  withInstantlyRestaurantLock,
} from "../outreach/instantlyService";
import { enqueueAllInstantlyCancellationIntents } from "../services/instantly/cancellationIntents";

const DAILY_MAXIMUM = 20;
const COOLDOWN_DAYS = 90;

// Conservative durable barrier: even an unreadable/skipped inbound message
// stops the sequence. Ignore only the original outbound message on each thread.
function noStagedReplies() {
  return sql`not exists (
    select 1 from ${gmailHistoryMessagesTable}
    inner join ${gmailOutreachThreadsTable}
      on ${gmailHistoryMessagesTable.threadId} = ${gmailOutreachThreadsTable.threadId}
    where ${gmailOutreachThreadsTable.placeId} = ${restaurantsTable.placeId}
      and ${gmailHistoryMessagesTable.messageId} <> ${gmailOutreachThreadsTable.sentMessageId}
  )`;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normaliseEmail(value: string): string | null {
  const result = validateEmail(value);
  return result.status === "valid" ? result.email : null;
}

export async function discoverPublicBusinessEmail(
  placeId: string,
  _website: string,
): Promise<string | null> {
  const result = await enrichRestaurant(placeId);
  if (result.ok) {
    const email = result.email;
    await db
      .update(restaurantsTable)
      .set({
        // Keep an eligible record in the initial-send state. "ready" records
        // from older runs are also selected below for backwards compatibility.
        outreachStatus: email ? "pending" : "no_business_email",
        outreachFailure: email ? null : "No allowlisted role mailbox was published.",
      })
      .where(eq(restaurantsTable.placeId, placeId));
    await db.insert(outreachAuditTable).values({
      placeId,
      event: email ? "email_discovered" : "email_not_found",
      recipientDomain: email?.split("@")[1],
    });
    return email;
  }
  const detail = result.error.message.slice(0, 500);
  await db
    .update(restaurantsTable)
    .set({ outreachStatus: "extraction_failed", outreachFailure: detail })
    .where(eq(restaurantsTable.placeId, placeId));
  await db
    .insert(outreachAuditTable)
    .values({ placeId, event: "extraction_failed", detail });
  return null;
}

function nextCooldown(): Date {
  return new Date(Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1_000);
}

export async function runDailyOutreach(options: {
  placeId?: string;
  initialOnly?: boolean;
  followupStep?: FollowupStep;
} = {}): Promise<{
  discovered: number;
  sent: number;
  reconciled: number;
  queued: number;
  skipped: number;
  failed: number;
  dailyMaximum: 20;
}> {
  if (options.followupStep !== undefined && ![2, 3].includes(options.followupStep)) {
    throw new Error("Invalid follow-up step.");
  }
  if (process.env.OUTREACH_ENABLED !== "true") {
    throw new Error("Outreach sending is disabled. Set OUTREACH_ENABLED=true explicitly.");
  }
  // Fail before reserving a shared daily slot or changing a restaurant record
  // when the new provider has not been explicitly configured.
  assertInstantlyCampaignConfiguration();
  const publicUrl = await assertPublicHttpsUrl(process.env.PUBLIC_APP_URL, {
    canonical: true,
  });
  const configuredLimit = Number(process.env.OUTREACH_DAILY_LIMIT ?? DAILY_MAXIMUM);
  if (!Number.isInteger(configuredLimit) || configuredLimit < 1 || configuredLimit > DAILY_MAXIMUM) {
    throw new Error("OUTREACH_DAILY_LIMIT must be an integer from 1 to 20.");
  }

  const lockClient = await pool.connect();
  const lockKey = 1_904_202_499;
  let locked = false;
  try {
    const lockResult = await lockClient.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [lockKey],
    );
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) throw new Error("Another outreach run is already active.");
    // A complete, resumable inbox pass runs inside the delivery lock before
    // every initial or follow-up reservation. If it cannot complete, sending
    // fails closed and no campaign is created.
    await reconcileInstantlyInboxFully();
    await drainInstantlyCampaignCancellations();
    const reconciled = await reconcileInstantlySentMessages();

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const [{ count: sentToday }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(outreachAuditTable)
      .where(
        and(
          eq(outreachAuditTable.event, "send_attempt"),
          gte(outreachAuditTable.createdAt, dayStart),
        ),
      );
    const remaining = Math.max(0, configuredLimit - Number(sentToday ?? 0));
    if (!remaining) {
      return { discovered: 0, sent: 0, reconciled, queued: 0, skipped: 0, failed: 0, dailyMaximum: 20 };
    }
    if (options.initialOnly && options.placeId) {
      const [attempt] = await db.select({ id: outreachAuditTable.id })
        .from(outreachAuditTable)
        .where(and(
          eq(outreachAuditTable.placeId, options.placeId),
          eq(outreachAuditTable.event, "send_attempt"),
        )).limit(1);
      if (attempt) {
        return { discovered: 0, sent: 0, reconciled, queued: 0, skipped: 1, failed: 0, dailyMaximum: 20 };
      }
    }

    const candidates = await db
      .select()
      .from(restaurantsTable)
      .where(
        and(
          isNull(restaurantsTable.suppressedAt),
          isNull(restaurantsTable.claimedAt),
          isNull(restaurantsTable.claimStatus),
          isNull(restaurantsTable.claimAttemptId),
          noStagedReplies(),
          options.placeId ? eq(restaurantsTable.placeId, options.placeId) : undefined,
          eq(restaurantsTable.outreachCount, options.followupStep ? options.followupStep - 1 : 0),
          options.followupStep
            ? eq(restaurantsTable.outreachStatus, options.followupStep === 2 ? "sent" : "followup_sent")
            : or(
                eq(restaurantsTable.outreachStatus, "pending"),
                eq(restaurantsTable.outreachStatus, "ready"),
              ),
          options.followupStep ? undefined : or(
            isNull(restaurantsTable.nextOutreachAfter),
            lte(restaurantsTable.nextOutreachAfter, new Date()),
          ),
        ),
      )
      .orderBy(restaurantsTable.importedAt)
      .limit(Math.min(50, remaining * 3));

    let discovered = 0;
    let sent = 0;
    let queued = 0;
    let skipped = 0;
    let failed = 0;
    let attempts = 0;
    for (const candidate of candidates) {
      if (attempts >= remaining) break;
      const history = await db.select().from(outreachAuditTable)
        .where(eq(outreachAuditTable.placeId, candidate.placeId));
      if (options.followupStep
        ? !isFollowupDue(options.followupStep, history, new Date())
        : history.some((item) => item.event === "send_attempt")) {
        skipped += 1;
        continue;
      }
      if (options.followupStep) {
        // Unreadable/skipped inbound messages also stop the sequence.
        const [pending] = await db.select({ id: gmailHistoryMessagesTable.messageId })
          .from(gmailHistoryMessagesTable)
          .innerJoin(gmailOutreachThreadsTable,
            eq(gmailHistoryMessagesTable.threadId, gmailOutreachThreadsTable.threadId))
          .where(and(eq(gmailOutreachThreadsTable.placeId, candidate.placeId),
            sql`${gmailHistoryMessagesTable.messageId} <> ${gmailOutreachThreadsTable.sentMessageId}`)).limit(1);
        if (pending) { skipped += 1; continue; }
      }
      let email = candidate.publicBusinessEmail;
      if (!email && candidate.website) {
        email = await discoverPublicBusinessEmail(candidate.placeId, candidate.website);
        if (email) discovered += 1;
      }
      email = email ? normaliseEmail(email) : null;
      if (!email) {
        skipped += 1;
        continue;
      }
      // Targeted initial outreach uses a fresh draft from trusted DB fields.
      // Caller-provided recipients, bodies, and statuses cannot bypass safeguards.
      const message = options.followupStep
        ? buildFollowupMessage(options.followupStep, candidate.name)
        : await generateOutreachFor({
            placeId: candidate.placeId,
            name: candidate.name,
            city: candidate.city,
            rating: candidate.rating,
            website: candidate.website,
            cuisine: candidate.cuisineTags[0],
          });

      const token = randomBytes(32).toString("base64url");
      // Keep all earlier unsubscribe links valid when issuing a follow-up.
      if (candidate.unsubscribeTokenHash) {
        await db.insert(outreachAuditTable).values({
          placeId: candidate.placeId,
          event: "unsubscribe_token",
          detail: candidate.unsubscribeTokenHash,
        });
      }
      const [claimed] = await db
        .update(restaurantsTable)
        .set({
          outreachStatus: "sending",
          unsubscribeTokenHash: tokenHash(token),
          outreachFailure: null,
        })
        .where(
          and(
            eq(restaurantsTable.placeId, candidate.placeId),
            isNull(restaurantsTable.suppressedAt),
            isNull(restaurantsTable.claimedAt),
            isNull(restaurantsTable.claimStatus),
            isNull(restaurantsTable.claimAttemptId),
            noStagedReplies(),
            eq(restaurantsTable.outreachStatus, candidate.outreachStatus),
            eq(restaurantsTable.outreachCount, candidate.outreachCount),
            options.followupStep ? undefined : or(
              isNull(restaurantsTable.nextOutreachAfter),
              lte(restaurantsTable.nextOutreachAfter, new Date()),
            ),
          ),
        )
        .returning({ placeId: restaurantsTable.placeId });
      if (!claimed) {
        skipped += 1;
        continue;
      }

      try {
        const unsubscribeUrl = new URL(
          `/api/outreach/unsubscribe/${token}`,
          publicUrl,
        ).href;
        // Reserve the daily slot before the external call. Counting attempts,
        // rather than acknowledgements, keeps the hard cap safe on crashes.
        await db.insert(outreachAuditTable).values({
          placeId: candidate.placeId,
          event: "send_attempt",
          recipientDomain: email.split("@")[1],
          detail: JSON.stringify({ emailNumber: options.followupStep ?? 1 }),
        });
        attempts += 1;
        const providerQueue = await sendInstantlyEmail({
          placeId: candidate.placeId,
          name: candidate.name,
          subject: message.subject,
          body: `${message.body}\r\n\r\nUnsubscribe: ${unsubscribeUrl}`,
        }, email, options.followupStep ?? 1);
        await db.transaction(async (tx) => {
          await tx
            .update(restaurantsTable)
            .set({
              // A reply, claim, or opt-out arriving during Instantly's request
              // wins. A campaign/lead acknowledgement is not delivery, so this
              // must never be recorded as "sent".
              outreachStatus: sql`case when ${restaurantsTable.outreachStatus} = 'sending'
                and ${restaurantsTable.suppressedAt} is null and ${restaurantsTable.claimedAt} is null
                then 'instantly_queued'
                else ${restaurantsTable.outreachStatus} end`,
              nextOutreachAfter: nextCooldown(),
            })
            .where(eq(restaurantsTable.placeId, candidate.placeId));
          await tx.insert(outreachAuditTable).values({
            placeId: candidate.placeId,
            event: providerQueue.activated ? "instantly_activated" : "instantly_queued",
            recipientDomain: email.split("@")[1],
            detail: JSON.stringify({ campaignId: providerQueue.campaignId }),
          });
        });
        queued += 1;
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 500) : "Instantly request failed.";
        await db
          .update(restaurantsTable)
          .set({
            outreachStatus: "send_failed",
            outreachFailure: detail,
            nextOutreachAfter: new Date(Date.now() + 24 * 60 * 60 * 1_000),
          })
          .where(and(eq(restaurantsTable.placeId, candidate.placeId),
            eq(restaurantsTable.outreachStatus, "sending"),
            isNull(restaurantsTable.suppressedAt), isNull(restaurantsTable.claimedAt)));
        await db.insert(outreachAuditTable).values({
          placeId: candidate.placeId,
          event: "send_failed",
          recipientDomain: email.split("@")[1],
          detail,
        });
        failed += 1;
      }
    }
    return { discovered, sent, reconciled, queued, skipped, failed, dailyMaximum: 20 };
  } finally {
    if (locked) await lockClient.query("select pg_advisory_unlock($1)", [lockKey]);
    lockClient.release();
  }
}

export async function suppressByToken(token: string): Promise<boolean> {
  if (token.length < 32 || token.length > 128) return false;
  const hash = tokenHash(token);
  const [candidate] = await db.select({ placeId: restaurantsTable.placeId })
    .from(restaurantsTable)
    .where(or(
      eq(restaurantsTable.unsubscribeTokenHash, hash),
      sql`exists (select 1 from ${outreachAuditTable}
        where ${outreachAuditTable.placeId} = ${restaurantsTable.placeId}
        and ${outreachAuditTable.event} = 'unsubscribe_token'
        and ${outreachAuditTable.detail} = ${hash})`,
    ))
    .limit(1);
  if (!candidate) return false;
  return withInstantlyRestaurantLock(candidate.placeId, async () => {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(restaurantsTable)
        .set({
          suppressedAt: new Date(),
          suppressionReason: "unsubscribe",
          outreachStatus: "suppressed",
          publicBusinessEmail: null,
        })
        .where(and(
          eq(restaurantsTable.placeId, candidate.placeId),
          or(
            eq(restaurantsTable.unsubscribeTokenHash, hash),
            sql`exists (select 1 from ${outreachAuditTable}
              where ${outreachAuditTable.placeId} = ${restaurantsTable.placeId}
              and ${outreachAuditTable.event} = 'unsubscribe_token'
              and ${outreachAuditTable.detail} = ${hash})`,
          ),
        ))
        .returning({ placeId: restaurantsTable.placeId });
      if (!row) return false;
      await tx.insert(outreachAuditTable).values({
        placeId: row.placeId,
        event: "unsubscribed",
      });
      await enqueueAllInstantlyCancellationIntents(tx, row.placeId);
      return true;
    });
  });
}