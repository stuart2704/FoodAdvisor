import { createHash, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { Router, type IRouter } from "express";
import {
  db,
  gmailWatchStateTable,
  pool,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { RenewGmailWatchResponse } from "@workspace/api-zod";
import { assertPublicHttpsUrl } from "../lib/public-url";
import {
  activateGmailWatch,
  getGmailProfile,
  GmailHttpError,
  listGmailHistory,
  validHistoryId,
} from "../services/gmail/gmailClient";
import {
  pollGmailReplies,
  processGmailMessageIds,
} from "../services/gmail/gmailWebhookHandler";

const router: IRouter = Router();
const oidcClient = new OAuth2Client();
const PUSH_PATH = "/api/gmail/push";
const MAX_ENVELOPE_BYTES = 32_000;
const MAX_DATA_CHARS = 8_192;
const PUSH_LOCK_KEY = 1_904_202_501;

function validAutomationToken(header: string | undefined): boolean {
  const expected = process.env.AUTOMATION_TOKEN;
  const supplied = header?.match(/^Bearer (.+)$/i)?.[1];
  if (!expected || expected.length < 32 || !supplied) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

function configuredTopic(): string {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic || !/^projects\/[^/]+\/topics\/[^/]+$/.test(topic)) {
    throw new Error("Gmail Pub/Sub topic is not configured.");
  }
  return topic;
}

interface PushPayload {
  subscription: string;
  message: {
    messageId: string;
    data: string;
  };
}

function parseEnvelope(body: unknown): PushPayload {
  if (Buffer.byteLength(JSON.stringify(body ?? null), "utf8") > MAX_ENVELOPE_BYTES) {
    throw new Error("Invalid Pub/Sub request.");
  }
  if (typeof body !== "object" || body === null) throw new Error("Invalid Pub/Sub request.");
  const envelope = body as { subscription?: unknown; message?: unknown };
  const message =
    typeof envelope.message === "object" && envelope.message !== null
      ? (envelope.message as { messageId?: unknown; data?: unknown })
      : undefined;
  if (
    typeof envelope.subscription !== "string" ||
    envelope.subscription !== process.env.GMAIL_PUBSUB_SUBSCRIPTION ||
    !message ||
    typeof message.messageId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,255}$/.test(message.messageId) ||
    typeof message.data !== "string" ||
    message.data.length < 1 ||
    message.data.length > MAX_DATA_CHARS ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)
  ) {
    throw new Error("Invalid Pub/Sub request.");
  }
  return {
    subscription: envelope.subscription,
    message: { messageId: message.messageId, data: message.data },
  };
}

function decodeNotification(data: string): { emailAddress: string; historyId: string } {
  const decoded = Buffer.from(data, "base64");
  if (
    decoded.byteLength > 4_096 ||
    decoded.toString("base64").replace(/=+$/, "") !== data.replace(/=+$/, "")
  ) {
    throw new Error("Invalid Pub/Sub request.");
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw new Error("Invalid Pub/Sub request.");
  }
  if (typeof value !== "object" || value === null) throw new Error("Invalid Pub/Sub request.");
  const item = value as { emailAddress?: unknown; historyId?: unknown };
  if (
    typeof item.emailAddress !== "string" ||
    item.emailAddress.length > 254 ||
    !validHistoryId(item.historyId)
  ) {
    throw new Error("Invalid Pub/Sub request.");
  }
  return { emailAddress: item.emailAddress.toLowerCase(), historyId: item.historyId };
}

async function verifyPushIdentity(header: string | undefined): Promise<void> {
  const token = header?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
  const expectedEmail = process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT;
  if (!token || token.length > 10_000 || !expectedEmail) {
    throw new Error("Invalid Pub/Sub identity.");
  }
  const origin = await assertPublicHttpsUrl(process.env.PUBLIC_APP_URL, { canonical: true });
  const ticket = await oidcClient.verifyIdToken({
    idToken: token,
    audience: `${origin.origin}${PUSH_PATH}`,
  });
  const payload = ticket.getPayload();
  if (
    !payload ||
    (payload.iss !== "accounts.google.com" &&
      payload.iss !== "https://accounts.google.com") ||
    payload.email_verified !== true ||
    payload.email !== expectedEmail
  ) {
    throw new Error("Invalid Pub/Sub identity.");
  }
}

router.post("/gmail/watch", async (req, res): Promise<void> => {
  if (!validAutomationToken(req.header("authorization"))) {
    res.status(401).json({ error: "Invalid automation credential." });
    return;
  }
  try {
    const topicName = configuredTopic();
    const profile = await getGmailProfile();
    const existing = await db.select().from(gmailWatchStateTable).limit(2);
    if (existing.some((row) => row.accountEmail !== profile.emailAddress)) {
      throw new Error("The managed Gmail account does not match watch state.");
    }
    const watch = await activateGmailWatch(topicName);
    const current = existing.find((row) => row.accountEmail === profile.emailAddress);
    await db
      .insert(gmailWatchStateTable)
      .values({
        accountEmail: profile.emailAddress,
        lastHistoryId: current?.lastHistoryId ?? watch.historyId,
        watchExpiration: watch.expiration,
        topicName,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: gmailWatchStateTable.accountEmail,
        set: {
          watchExpiration: watch.expiration,
          topicName,
          updatedAt: new Date(),
        },
      });
    res.json(
      RenewGmailWatchResponse.parse({
        historyId: current?.lastHistoryId ?? watch.historyId,
        expiration: watch.expiration,
        topic: topicName,
      }),
    );
  } catch {
    res.status(503).json({ error: "Gmail watch could not be activated." });
  }
});

router.post("/gmail/push", async (req, res): Promise<void> => {
  try {
    await verifyPushIdentity(req.header("authorization"));
  } catch {
    res.status(401).json({ error: "Invalid Pub/Sub identity." });
    return;
  }

  let notification: { emailAddress: string; historyId: string };
  try {
    const envelope = parseEnvelope(req.body);
    notification = decodeNotification(envelope.message.data);
  } catch {
    res.status(400).json({ error: "Invalid Pub/Sub request." });
    return;
  }

  const lockClient = await pool.connect();
  let locked = false;
  try {
    const lockResult = await lockClient.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [PUSH_LOCK_KEY],
    );
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) {
      res.status(503).json({ error: "Gmail push is temporarily unavailable." });
      return;
    }

    const [state] = await db
      .select()
      .from(gmailWatchStateTable)
      .where(eq(gmailWatchStateTable.accountEmail, notification.emailAddress))
      .limit(1);
    if (!state) {
      res.status(400).json({ error: "Invalid Pub/Sub request." });
      return;
    }
    if (BigInt(notification.historyId) <= BigInt(state.lastHistoryId)) {
      res.status(204).end();
      return;
    }

    try {
      const history = await listGmailHistory(state.lastHistoryId);
      if (BigInt(history.historyId) < BigInt(state.lastHistoryId)) {
        throw new Error("Gmail returned an invalid history cursor.");
      }
      const result = await processGmailMessageIds(history.messageIds);
      if (result.failed || result.capped) {
        res.status(503).json({ error: "Gmail push processing was incomplete." });
        return;
      }
      await db
        .update(gmailWatchStateTable)
        .set({ lastHistoryId: history.historyId, updatedAt: new Date() })
        .where(eq(gmailWatchStateTable.accountEmail, state.accountEmail));
    } catch (error) {
      if (!(error instanceof GmailHttpError) || error.status !== 404) throw error;
      // Establish the new watch boundary before polling. Messages arriving after
      // this boundary remain available from the saved baseline on redelivery.
      const watch = await activateGmailWatch(state.topicName);
      const recovery = await pollGmailReplies();
      if (recovery.failed || recovery.capped) {
        throw new Error("Gmail history recovery was incomplete.");
      }
      await db
        .update(gmailWatchStateTable)
        .set({
          lastHistoryId: watch.historyId,
          watchExpiration: watch.expiration,
          updatedAt: new Date(),
        })
        .where(eq(gmailWatchStateTable.accountEmail, state.accountEmail));
    }
    res.status(204).end();
  } catch {
    res.status(503).json({ error: "Gmail push processing failed." });
  } finally {
    if (locked) await lockClient.query("select pg_advisory_unlock($1)", [PUSH_LOCK_KEY]);
    lockClient.release();
  }
});

export default router;