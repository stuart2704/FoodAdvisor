import { createHash, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  db,
  gmailHistoryMessagesTable,
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
  drainStagedGmailMessages,
  stageGmailRecovery,
} from "../services/gmail/gmailWebhookHandler";
import {
  completedRecoveryState,
  historyDeliveryStatus,
  gmailPushStatus,
  gmailNotificationStatus,
} from "../services/gmail/gmailContracts";

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

export function createGmailWatchHandler(adminEnvelope = false): RequestHandler {
  return async (req, res): Promise<void> => {
  if (!validAutomationToken(req.header("authorization"))) {
    res.status(401).json({ ...(adminEnvelope ? { ok: false } : {}), error: "Invalid automation credential." });
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
    const result = RenewGmailWatchResponse.parse({
        historyId: current?.lastHistoryId ?? watch.historyId,
        expiration: watch.expiration,
        topic: topicName,
      });
    res.json(adminEnvelope ? { ok: true, result } : result);
  } catch {
    req.log.warn("Gmail watch activation failed.");
    res.status(503).json({ ...(adminEnvelope ? { ok: false } : {}), error: "Gmail watch could not be activated." });
  }
  };
}

router.post("/gmail/watch", createGmailWatchHandler());

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
    res.status(gmailPushStatus({ authenticated: true, poison: true })).end();
    return;
  }

  let lockClient:
    | {
        query: <T = unknown>(
          queryText: string,
          values?: readonly unknown[],
        ) => Promise<{ rows: T[] }>;
        release: (destroy?: boolean) => void;
      }
    | undefined;
  let locked = false;
  try {
    lockClient = (await pool.connect()) as unknown as NonNullable<typeof lockClient>;
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
      const [managedAccount] = await db
        .select({ accountEmail: gmailWatchStateTable.accountEmail })
        .from(gmailWatchStateTable)
        .limit(1);
      if (managedAccount) {
        // Authenticated notification for a different, permanently unmanaged
        // account is poison, whereas an empty table is a startup race.
        res.status(204).end();
        return;
      }
      res
        .status(gmailNotificationStatus({
          authenticated: true,
          poison: false,
          hasWatchState: false,
        }))
        .json({ error: "Gmail watch state is not ready." });
      return;
    }

    try {
      let scanStart = state.historyScanStartId ?? state.lastHistoryId;
      let pageToken = state.historyPageToken ?? undefined;
      let complete = false;
      for (let page = 0; page < 10; page += 1) {
        if (!pageToken && BigInt(notification.historyId) <= BigInt(state.lastHistoryId)) {
          complete = true;
          break;
        }
        const history = await listGmailHistory(scanStart, pageToken);
        await db.transaction(async (tx) => {
          for (const message of history.messages) {
            await tx
              .insert(gmailHistoryMessagesTable)
              .values({
                accountEmail: state.accountEmail,
                messageId: message.id,
                threadId: message.threadId,
                status: "pending",
                updatedAt: new Date(),
              })
              .onConflictDoNothing();
          }
          if (history.nextPageToken) {
            await tx
              .update(gmailWatchStateTable)
              .set({
                historyScanStartId: scanStart,
                historyPageToken: history.nextPageToken,
                updatedAt: new Date(),
              })
              .where(eq(gmailWatchStateTable.accountEmail, state.accountEmail));
          } else {
            await tx
              .update(gmailWatchStateTable)
              .set({
                lastHistoryId: history.historyId,
                historyScanStartId: null,
                historyPageToken: null,
                updatedAt: new Date(),
              })
              .where(eq(gmailWatchStateTable.accountEmail, state.accountEmail));
          }
        });
        if (!history.nextPageToken) {
          complete = true;
          break;
        }
        pageToken = history.nextPageToken;
      }
      const drain = await drainStagedGmailMessages(state.accountEmail);
      if (historyDeliveryStatus({
        complete,
        failed: drain.failed > 0,
        capped: drain.capped,
      }) !== 204) {
        res.status(503).json({ error: "Gmail push processing is incomplete." });
        return;
      }
    } catch (error) {
      if (!(error instanceof GmailHttpError) || error.status !== 404) throw error;
      // Establish the new watch boundary before durable discovery. Messages
      // arriving after this boundary remain available on the new cursor.
      const watch = await activateGmailWatch(state.topicName);
      await stageGmailRecovery(state.accountEmail);
      await db.transaction(async (tx) => {
        const recoveryState = completedRecoveryState({
            lastHistoryId: watch.historyId,
            watchExpiration: watch.expiration,
            updatedAt: new Date(),
          });
        await tx
          .update(gmailWatchStateTable)
          .set(recoveryState)
          .where(eq(gmailWatchStateTable.accountEmail, state.accountEmail));
      });
      const drain = await drainStagedGmailMessages(state.accountEmail);
      if (drain.failed || drain.capped) {
        res.status(503).json({ error: "Gmail push processing is incomplete." });
        return;
      }
    }
    res.status(204).end();
  } catch {
    res.status(503).json({ error: "Gmail push processing failed." });
  } finally {
    let destroy = false;
    try {
      if (locked && lockClient) {
        await lockClient.query("select pg_advisory_unlock($1)", [PUSH_LOCK_KEY]);
      }
    } catch {
      destroy = true;
      if (!res.headersSent) {
        res.status(503).json({ error: "Gmail push cleanup failed." });
      }
    } finally {
      lockClient?.release(destroy);
    }
  }
});

export default router;