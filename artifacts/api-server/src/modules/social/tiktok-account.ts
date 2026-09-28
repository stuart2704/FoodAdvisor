/** Fail closed if the creator changed or more than one profile is connected. */
export function reviewedTikTokAccount<T extends { id: string }>(
  accounts: readonly T[],
  accountId?: string | null,
): T | null {
  if (accounts.length !== 1) return null;
  const account = accounts[0]!;
  return accountId == null || account.id === accountId ? account : null;
}

/** A pending publish must be checked with the profile that submitted it. */
export function pendingTikTokAccount<T extends { id: string }>(
  accounts: readonly T[],
  accountId: string | null,
): T | null {
  if (!accountId) return null;
  return accounts.find(account => account.id === accountId) ?? null;
}