import { createHash, randomBytes } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  db,
  gmailOutreachThreadsTable,
  outreachAuditTable,
  pool,
  restaurantsTable,
} from "@workspace/db";
import { and, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { enrichRestaurant } from "../services/enrichment/enrichRestaurant";
import { validateEmail } from "../services/enrichment/validateEmail";
import { assertPublicHttpsUrl } from "./public-url";

const DAILY_MAXIMUM = 20;
const COOLDOWN_DAYS = 90;

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
        outreachStatus: email ? "ready" : "no_business_email",
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

function buildRawEmail(input: {
  to: string;
  restaurantName: string;
  unsubscribeUrl: string;
}): string {
  const subject = `A listing opportunity for ${input.restaurantName}`;
  const body = [
    `Hello ${input.restaurantName} team,`,
    "",
    "The Food Advisor helps diners discover independent restaurants across the UK.",
    "A basic listing is free. Verification is optional and costs £99 GBP per month; you do not need to subscribe to have a basic listing.",
    "",
    "Learn more: https://thefoodadvisor.co.uk",
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\r\n");
  return [
    `To: ${input.to}`,
    "From: The Food Advisor",
    `Subject: ${subject.replace(/[^\x20-\x7E]/g, "")}`,
    "Content-Type: text/plain; charset=UTF-8",
    `List-Unsubscribe: <${input.unsubscribeUrl}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    "",
    body,
  ].join("\r\n");
}

interface GmailSendResult {
  id: string;
  threadId: string;
}

export async function sendGmail(rawMessage: string): Promise<GmailSendResult> {
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy(
    "google-mail",
    "/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw: Buffer.from(rawMessage).toString("base64url"),
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Gmail connector returned HTTP ${response.status}.`);
  }
  const value: unknown = await response.json();
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { id?: unknown }).id !== "string" ||
    typeof (value as { threadId?: unknown }).threadId !== "string"
  ) {
    throw new Error("Gmail connector returned an invalid send acknowledgement.");
  }
  const { id, threadId } = value as { id: string; threadId: string };
  if (!id || id.length > 255 || !threadId || threadId.length > 255) {
    throw new Error("Gmail connector returned invalid message identifiers.");
  }
  return { id, threadId };
}

function nextCooldown(): Date {
  return new Date(Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1_000);
}

export async function runDailyOutreach(): Promise<{
  discovered: number;
  sent: number;
  skipped: number;
  failed: number;
  dailyMaximum: 20;
}> {
  if (process.env.OUTREACH_ENABLED !== "true") {
    throw new Error("Outreach sending is disabled. Set OUTREACH_ENABLED=true explicitly.");
  }
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
      return { discovered: 0, sent: 0, skipped: 0, failed: 0, dailyMaximum: 20 };
    }

    const candidates = await db
      .select()
      .from(restaurantsTable)
      .where(
        and(
          isNull(restaurantsTable.suppressedAt),
          isNull(restaurantsTable.claimedAt),
          ne(restaurantsTable.outreachStatus, "sending"),
          or(
            isNull(restaurantsTable.nextOutreachAfter),
            lte(restaurantsTable.nextOutreachAfter, new Date()),
          ),
        ),
      )
      .orderBy(restaurantsTable.importedAt)
      .limit(Math.min(50, remaining * 3));

    let discovered = 0;
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let attempts = 0;
    for (const candidate of candidates) {
      if (attempts >= remaining) break;
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

      const token = randomBytes(32).toString("base64url");
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
            or(
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
        });
        attempts += 1;
        const gmailMessage = await sendGmail(
          buildRawEmail({
            to: email,
            restaurantName: candidate.name,
            unsubscribeUrl,
          }),
        );
        await db.transaction(async (tx) => {
          await tx.insert(gmailOutreachThreadsTable).values({
            threadId: gmailMessage.threadId,
            sentMessageId: gmailMessage.id,
            placeId: candidate.placeId,
          });
          await tx
            .update(restaurantsTable)
            .set({
              outreachStatus: "sent",
              lastOutreachAt: new Date(),
              nextOutreachAfter: nextCooldown(),
              outreachCount: sql`${restaurantsTable.outreachCount} + 1`,
            })
            .where(eq(restaurantsTable.placeId, candidate.placeId));
          await tx.insert(outreachAuditTable).values({
            placeId: candidate.placeId,
            event: "sent",
            recipientDomain: email.split("@")[1],
            detail: JSON.stringify({
              gmailMessageId: gmailMessage.id,
              gmailThreadId: gmailMessage.threadId,
            }),
          });
        });
        sent += 1;
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 500) : "Send failed.";
        await db
          .update(restaurantsTable)
          .set({
            outreachStatus: "send_failed",
            outreachFailure: detail,
            nextOutreachAfter: new Date(Date.now() + 24 * 60 * 60 * 1_000),
          })
          .where(eq(restaurantsTable.placeId, candidate.placeId));
        await db.insert(outreachAuditTable).values({
          placeId: candidate.placeId,
          event: "send_failed",
          recipientDomain: email.split("@")[1],
          detail,
        });
        failed += 1;
      }
    }
    return { discovered, sent, skipped, failed, dailyMaximum: 20 };
  } finally {
    if (locked) await lockClient.query("select pg_advisory_unlock($1)", [lockKey]);
    lockClient.release();
  }
}

export async function suppressByToken(token: string): Promise<boolean> {
  if (token.length < 32 || token.length > 128) return false;
  const [row] = await db
    .update(restaurantsTable)
    .set({
      suppressedAt: new Date(),
      suppressionReason: "unsubscribe",
      outreachStatus: "suppressed",
      publicBusinessEmail: null,
    })
    .where(eq(restaurantsTable.unsubscribeTokenHash, tokenHash(token)))
    .returning({ placeId: restaurantsTable.placeId });
  if (!row) return false;
  await db.insert(outreachAuditTable).values({
    placeId: row.placeId,
    event: "unsubscribed",
  });
  return true;
}