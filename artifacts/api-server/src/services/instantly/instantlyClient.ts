const INSTANTLY_API_ORIGIN = "https://api.instantly.ai";

export interface InstantlyRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export class InstantlyConfigurationError extends Error {}

export function assertInstantlyApiKeyConfigured(): void {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key?.trim() || /[\r\n]/.test(key)) {
    throw new InstantlyConfigurationError("INSTANTLY_API_KEY must be configured as a project secret.");
  }
}

export async function instantlyRequest(
  path: string,
  options: InstantlyRequestOptions = {},
): Promise<Response> {
  assertInstantlyApiKeyConfigured();
  if (!path.startsWith("/v2/") || path.startsWith("//")) {
    throw new Error("Invalid Instantly API path.");
  }
  const key = process.env.INSTANTLY_API_KEY!.trim();
  return fetch(`${INSTANTLY_API_ORIGIN}/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...options.headers,
      Authorization: `Bearer ${key}`,
    },
    body: options.body === undefined ? undefined
      : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
    signal: AbortSignal.timeout(15_000),
  });
}