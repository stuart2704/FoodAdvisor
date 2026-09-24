export async function fetchSocial<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  try {
    const res = await fetch(`/admin/social${path}`, {
      ...options,
      credentials: "include",
      cache: "no-store",
      signal: options?.signal || controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {})
      }
    });
    if (res.status === 401) {
      throw new Error("Your admin session has expired. Sign in again.");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(data?.error || `Request failed (${res.status}).`);
    }
    return await res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error("Request timed out. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
