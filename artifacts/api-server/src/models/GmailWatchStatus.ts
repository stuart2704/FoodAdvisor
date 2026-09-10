import { db, gmailWatchStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface GmailWatchStatus {
  expirationTime: number;
  // Gmail history IDs may exceed Number.MAX_SAFE_INTEGER.
  historyId: string;
  // Null means the renewal time predates explicit tracking.
  lastRenewedAt: Date | null;
}

export async function getGmailWatchStatus(
  accountEmail: string,
): Promise<GmailWatchStatus | null> {
  const [row] = await db.select().from(gmailWatchStateTable)
    .where(eq(gmailWatchStateTable.accountEmail, accountEmail.toLowerCase()))
    .limit(1);
  if (!row) return null;
  return {
    expirationTime: row.watchExpiration.getTime(),
    historyId: row.lastHistoryId,
    lastRenewedAt: row.lastRenewedAt,
  };
}

export default { getForAccount: getGmailWatchStatus };