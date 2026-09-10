import { db, gmailWatchStateTable } from "@workspace/db";
import { RenewGmailWatchResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import {
  activateGmailWatch as requestGmailWatch,
  getGmailProfile,
} from "./gmail/gmailClient";

// Use Replit's managed Gmail connector; do not store short-lived OAuth tokens.
export async function activateGmailWatch() {
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName || !/^projects\/[^/]+\/topics\/[^/]+$/.test(topicName)) {
    throw new Error("Gmail Pub/Sub topic is not configured.");
  }
  const profile = await getGmailProfile();
  const existing = await db.select().from(gmailWatchStateTable).limit(2);
  if (existing.some((row) => row.accountEmail !== profile.emailAddress)) {
    throw new Error("The managed Gmail account does not match watch state.");
  }
  const watch = await requestGmailWatch(topicName);
  const lastRenewedAt = new Date();
  const current = existing.find((row) => row.accountEmail === profile.emailAddress);
  await db.insert(gmailWatchStateTable).values({
    accountEmail: profile.emailAddress,
    lastHistoryId: current?.lastHistoryId ?? watch.historyId,
    watchExpiration: watch.expiration,
    lastRenewedAt,
    topicName,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: gmailWatchStateTable.accountEmail,
    // A renewal must not skip replies by replacing the durable history cursor.
    set: {
      watchExpiration: watch.expiration,
      lastRenewedAt,
      topicName,
      updatedAt: new Date(),
    },
  });
  const result = RenewGmailWatchResponse.parse({
    historyId: current?.lastHistoryId ?? watch.historyId,
    expiration: watch.expiration,
    topic: topicName,
  });
  logger.info("Gmail watch activated.");
  return result;
}

export async function renewGmailWatch() {
  try {
    const result = await activateGmailWatch();
    logger.info("Gmail watch renewed.");
    return result;
  } catch (error) {
    logger.warn("Gmail watch renewal failed.");
    throw error;
  }
}