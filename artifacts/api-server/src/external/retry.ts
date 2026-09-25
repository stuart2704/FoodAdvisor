export async function retry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 1_000,
): Promise<T> {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new Error("Retry attempts must be a positive integer.");
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("Retry delay must be a non-negative number.");
  }

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Retry attempts exhausted.");
}