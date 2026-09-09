import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  db,
  outreachAuditTable,
  pool,
  restaurantsTable,
} from "@workspace/db";
import { and, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { isPrivateAddress, assertPublicHttpsUrl } from "./public-url";

const DAILY_MAXIMUM = 20;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512_000;
const COOLDOWN_DAYS = 90;
const ROLE_MAILBOXES = new Set([
  "bookings",
  "catering",
  "contact",
  "enquiries",
  "events",
  "hello",
  "info",
  "office",
  "reservations",
  "restaurant",
  "support",
  "team",
]);

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normaliseEmail(value: string): string | null {
  const email = value.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0];
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) {
    return null;
  }
  const [local, domain] = email.split("@");
  // Exact role names only: names, initials, and role+person variants are rejected.
  if (!ROLE_MAILBOXES.has(local) || domain.includes("..")) return null;
  return email;
}

async function assertSafeWebsiteUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Website URL is not a safe HTTP(S) URL.");
  }
  if ((url.port && url.port !== "80" && url.port !== "443") || isIP(url.hostname)) {
    throw new Error("Website URL uses a disallowed host or port.");
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Website resolves to a private or reserved address.");
  }
  return url;
}

async function readBoundedHtml(response: Response): Promise<string> {
  if (!response.body) return "";
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) {
    throw new Error("Website response is too large.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("Website response exceeded the size limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchSafeHtml(initial: URL): Promise<{ html: string; url: URL }> {
  let current = initial;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    current = await assertSafeWebsiteUrl(current.href);
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "TheFoodAdvisorBot/1.0 (+https://thefoodadvisor.co.uk)",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Website redirect had no location.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Website returned HTTP ${response.status}.`);
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) {
      throw new Error("Website did not return HTML.");
    }
    return { html: await readBoundedHtml(response), url: current };
  }
  throw new Error("Website exceeded the redirect limit.");
}

function extractRoleEmail(html: string): string | null {
  const decoded = html
    .replace(/&#64;|&commat;|\s+\[at\]\s+|\s+\(at\)\s+/gi, "@")
    .replace(/&#46;|\s+\[dot\]\s+|\s+\(dot\)\s+/gi, ".");
  const candidates = decoded.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  for (const candidate of candidates) {
    const safe = normaliseEmail(candidate);
    if (safe) return safe;
  }
  return null;
}

export async function discoverPublicBusinessEmail(
  placeId: string,
  website: string,
): Promise<string | null> {
  try {
    const { html, url } = await fetchSafeHtml(await assertSafeWebsiteUrl(website));
    const email = extractRoleEmail(html);
    await db
      .update(restaurantsTable)
      .set({
        publicBusinessEmail: email,
        emailSourceUrl: url.href,
        emailDiscoveredAt: new Date(),
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
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Website extraction failed.";
    await db
      .update(restaurantsTable)
      .set({ outreachStatus: "extraction_failed", outreachFailure: detail })
      .where(eq(restaurantsTable.placeId, placeId));
    await db.insert(outreachAuditTable).values({ placeId, event: "extraction_failed", detail });
    return null;
  }
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
    "You can claim your listing and subscribe for £99 GBP per month.",
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

async function sendGmail(rawMessage: string): Promise<void> {
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
        await sendGmail(
          buildRawEmail({
            to: email,
            restaurantName: candidate.name,
            unsubscribeUrl,
          }),
        );
        await db
          .update(restaurantsTable)
          .set({
            outreachStatus: "sent",
            lastOutreachAt: new Date(),
            nextOutreachAfter: nextCooldown(),
            outreachCount: sql`${restaurantsTable.outreachCount} + 1`,
          })
          .where(eq(restaurantsTable.placeId, candidate.placeId));
        await db.insert(outreachAuditTable).values({
          placeId: candidate.placeId,
          event: "sent",
          recipientDomain: email.split("@")[1],
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