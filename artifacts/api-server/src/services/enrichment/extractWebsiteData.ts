import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { isPrivateAddress } from "../../lib/public-url";
import { ROLE_MAILBOXES, validateEmail } from "./validateEmail";

const REQUEST_DEADLINE_MS = 5_000;
const MAX_HTML_BYTES = 512_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MESSAGE = "Website request timed out.";

// Only exact role local-parts can pass validateEmail. The fixed-width local
// part and bounded domain prevent retries over an arbitrarily long word.
const roleEmailPattern = new RegExp(
  `(?<![a-z0-9.!#$%&'*+/=?^_\`{|}~-])(?:${[...ROLE_MAILBOXES].join("|")})@[a-z0-9.-]{1,253}\\.[a-z]{2,63}(?![a-z0-9.-])`,
  "gi",
);

export type WebsiteExtractionErrorCode =
  | "invalid_url"
  | "unsafe_url"
  | "dns_failure"
  | "timeout"
  | "network_failure"
  | "redirect_failure"
  | "http_error"
  | "invalid_content_type"
  | "response_too_large";

export type WebsiteExtractionResult =
  | {
      ok: true;
      data: {
        finalUrl: string;
        title: string | null;
        description: string | null;
        roleEmail: string | null;
      };
    }
  | {
      ok: false;
      error: { code: WebsiteExtractionErrorCode; message: string };
    };

class WebsiteExtractionError extends Error {
  constructor(
    readonly code: WebsiteExtractionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type ResolvedWebsite = { url: URL; address: string; family: 4 | 6 };

function timeoutError(): WebsiteExtractionError {
  return new WebsiteExtractionError("timeout", TIMEOUT_MESSAGE);
}

function withDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(timeoutError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(timeoutError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

async function assertSafeWebsiteUrl(raw: string, signal: AbortSignal): Promise<ResolvedWebsite> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebsiteExtractionError("invalid_url", "Website URL is not valid.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new WebsiteExtractionError(
      "unsafe_url",
      "Website URL must be public HTTP or HTTPS without credentials.",
    );
  }
  const expectedPort = url.protocol === "http:" ? "80" : "443";
  if ((url.port && url.port !== expectedPort) || isIP(url.hostname.replace(/^\[|\]$/g, ""))) {
    throw new WebsiteExtractionError(
      "unsafe_url",
      "Website URL uses a disallowed host or port.",
    );
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await withDeadline(lookup(url.hostname, { all: true, verbatim: true }), signal);
  } catch (error) {
    if (error instanceof WebsiteExtractionError) throw error;
    if (error instanceof Error && error.name === "TimeoutError") throw timeoutError();
    throw new WebsiteExtractionError(
      "dns_failure",
      "Website hostname could not be resolved.",
    );
  }
  if (!addresses.length || addresses.some(({ address, family }) =>
    (family !== 4 && family !== 6) || isIP(address) !== family || isPrivateAddress(address))) {
    throw new WebsiteExtractionError(
      "unsafe_url",
      "Website resolves to a private or reserved address.",
    );
  }
  const selected = addresses[0]!;
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

function requestPinned({ url, address, family }: ResolvedWebsite, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    // Keep the URL hostname for Host, SNI and certificate verification. Only
    // the socket's DNS lookup is replaced, with the validated answer for this hop.
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      agent: false,
      signal,
      family,
      ...(url.protocol === "https:" ? { servername: url.hostname, rejectUnauthorized: true } : {}),
      lookup: (_hostname, _options, callback) => callback(null, address, family),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "TheFoodAdvisorBot/1.0 (+https://thefoodadvisor.co.uk)",
      },
    }, (incoming) => {
      try {
        const status = incoming.statusCode ?? 0;
        const body = [204, 205, 304].includes(status)
          ? null
          : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        resolve(new Response(body, { status, headers }));
      } catch (error) {
        incoming.destroy();
        reject(error);
      }
    });
    request.once("error", (error) => reject(signal.aborted ? signal.reason : error));
    request.end();
  });
}

async function readBoundedHtml(response: Response, signal: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) {
    throw new WebsiteExtractionError(
      "response_too_large",
      "Website response is too large.",
    );
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await withDeadline(reader.read(), signal);
    } catch (error) {
      // A stalled stream's cancellation may itself never settle.
      void reader.cancel().catch(() => {});
      throw error;
    }
    const { done, value } = chunk;
    if (done) break;
    size += value.byteLength;
    if (size > MAX_HTML_BYTES) {
      void reader.cancel().catch(() => {});
      throw new WebsiteExtractionError(
        "response_too_large",
        "Website response exceeded the size limit.",
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    commat: "@",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      }
      return named[code.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseMetadata(value: string | undefined): string | null {
  if (!value) return null;
  const normalised = decodeHtml(value.replace(/<[^<>]*>/g, " ")).slice(0, 2_000);
  return normalised || null;
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(
    /([^\s"'=<>`]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
  )) {
    result.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function extractMetadata(html: string): {
  title: string | null;
  description: string | null;
  roleEmail: string | null;
} {
  // Search for a closing tag once. Repeated unclosed opening tags otherwise
  // cause the lazy title-body regex to rescan the rest of the page per tag.
  const titleEnd = html.search(/<\/title\s*>/i);
  const title = titleEnd < 0 ? null : normaliseMetadata(
    html.slice(0, titleEnd).match(/<title\b[^<>]*>([\s\S]*)$/i)?.[1],
  );
  let description: string | null = null;
  for (const tag of html.match(/<meta\b[^<>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const key = (attrs.get("name") ?? attrs.get("property") ?? "").toLowerCase();
    if (key === "description" || key === "og:description") {
      description = normaliseMetadata(attrs.get("content"));
      if (description) break;
    }
  }

  const decoded = decodeHtml(html)
    .replace(/\s+\[at\]\s+|\s+\(at\)\s+/gi, "@")
    .replace(/\s+\[dot\]\s+|\s+\(dot\)\s+/gi, ".");
  const candidates = decoded.match(roleEmailPattern) ?? [];
  const roleEmail =
    candidates
      .map(validateEmail)
      .find((result) => result.status === "valid")?.email ?? null;
  return { title, description, roleEmail };
}

export async function extractWebsiteData(
  website: string,
): Promise<WebsiteExtractionResult> {
  const signal = AbortSignal.timeout(REQUEST_DEADLINE_MS);
  try {
    let current = website;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      if (signal.aborted) throw timeoutError();
      const resolved = await assertSafeWebsiteUrl(current, signal);
      const { url } = resolved;
      let response: Response;
      try {
        response = await withDeadline(requestPinned(resolved, signal), signal);
      } catch (error) {
        if ((error instanceof WebsiteExtractionError && error.code === "timeout") ||
          (error instanceof Error && error.name === "TimeoutError") || signal.aborted) {
          throw timeoutError();
        }
        throw new WebsiteExtractionError(
          "network_failure",
          "Website request failed.",
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (response.body) await withDeadline(response.body.cancel(), signal);
        if (!location || redirects === MAX_REDIRECTS) {
          throw new WebsiteExtractionError(
            "redirect_failure",
            location
              ? "Website exceeded the redirect limit."
              : "Website redirect had no location.",
          );
        }
        current = new URL(location, url).href;
        continue;
      }
      if (!response.ok) {
        if (response.body) await withDeadline(response.body.cancel(), signal);
        throw new WebsiteExtractionError(
          "http_error",
          `Website returned HTTP ${response.status}.`,
        );
      }
      const contentType =
        response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ??
        "";
      if (!["text/html", "application/xhtml+xml"].includes(contentType)) {
        if (response.body) await withDeadline(response.body.cancel(), signal);
        throw new WebsiteExtractionError(
          "invalid_content_type",
          "Website did not return HTML.",
        );
      }
      const metadata = extractMetadata(await readBoundedHtml(response, signal));
      return {
        ok: true,
        data: { finalUrl: url.href, ...metadata },
      };
    }
    throw new WebsiteExtractionError(
      "redirect_failure",
      "Website exceeded the redirect limit.",
    );
  } catch (error) {
    if (signal.aborted || error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, error: { code: "timeout", message: TIMEOUT_MESSAGE } };
    }
    if (error instanceof WebsiteExtractionError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    return {
      ok: false,
      error: {
        code: "network_failure",
        message: error instanceof Error ? error.message : "Website extraction failed.",
      },
    };
  }
}