import { db, gmailWatchStateTable } from "@workspace/db";
import { RenewGmailWatchResponse } from "@workspace/api-zod";
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
  const current = existing.find((row) => row.accountEmail === profile.emailAddress);
  await db.insert(gmailWatchStateTable).values({
    accountEmail: profile.emailAddress,
    lastHistoryId: current?.lastHistoryId ?? watch.historyId,
    watchExpiration: watch.expiration,
    topicName,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: gmailWatchStateTable.accountEmail,
    // A renewal must not skip replies by replacing the durable history cursor.
    set: {
      watchExpiration: watch.expiration,
      topicName,
      updatedAt: new Date(),
    },
  });
  return RenewGmailWatchResponse.parse({
    historyId: current?.lastHistoryId ?? watch.historyId,
    expiration: watch.expiration,
    topic: topicName,
  });
}