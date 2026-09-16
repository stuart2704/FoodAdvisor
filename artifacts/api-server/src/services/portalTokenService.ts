import { createHash, randomBytes } from "node:crypto";
import { db, restaurantPortalTokensTable } from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function generateLoginToken(placeId: string): Promise<string> {
  if (!placeId.trim() || placeId.length > 512) {
    throw new Error("A valid restaurant ID is required.");
  }
  const token = randomBytes(32).toString("base64url");
  await db
    .insert(restaurantPortalTokensTable)
    .values({
      tokenHash: tokenHash(token),
      placeId: placeId.trim(),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    })
    .onConflictDoUpdate({
      target: restaurantPortalTokensTable.placeId,
      set: {
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        createdAt: new Date(),
        revokedAt: null,
      },
    });
  return token;
}

export async function validateToken(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [record] = await db
    .select({ placeId: restaurantPortalTokensTable.placeId })
    .from(restaurantPortalTokensTable)
    .where(
      and(
        eq(restaurantPortalTokensTable.tokenHash, tokenHash(token)),
        gt(restaurantPortalTokensTable.expiresAt, new Date()),
        isNull(restaurantPortalTokensTable.revokedAt),
      ),
    )
    .limit(1);
  return record?.placeId ?? null;
}

export default { generateLoginToken, validateToken };