import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateAddress } from "../../lib/public-url";
import { validateEmail } from "./validateEmail";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512_000;
const MAX_REDIRECTS = 3;

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

async function assertSafeWebsiteUrl(raw: string): Promise<URL> {
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
  if ((url.port && url.port !== expectedPort) || isIP(url.hostname)) {
    throw new WebsiteExtractionError(
      "unsafe_url",
      "Website URL uses a disallowed host or port.",
    );
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new WebsiteExtractionError(
      "dns_failure",
      "Website hostname could not be resolved.",
    );
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new WebsiteExtractionError(
      "unsafe_url",
      "Website resolves to a private or reserved address.",
    );
  }
  return url;
}

async function readBoundedHtml(response: Response): Promise<string> {
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
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_HTML_BYTES) {
      await reader.cancel();
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
  const normalised = decodeHtml(value.replace(/<[^>]*>/g, " ")).slice(0, 2_000);
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
  const title = normaliseMetadata(
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1],
  );
  let description: string | null = null;
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
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
  const candidates =
    decoded.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}/gi) ??
    [];
  const roleEmail =
    candidates
      .map(validateEmail)
      .find((result) => result.status === "valid")?.email ?? null;
  return { title, description, roleEmail };
}

export async function extractWebsiteData(
  website: string,
): Promise<WebsiteExtractionResult> {
  try {
    let current = await assertSafeWebsiteUrl(website);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      current = await assertSafeWebsiteUrl(current.href);
      let response: Response;
      try {
        response = await fetch(current, {
          redirect: "manual",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": "TheFoodAdvisorBot/1.0 (+https://thefoodadvisor.co.uk)",
          },
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new WebsiteExtractionError("timeout", "Website request timed out.");
        }
        throw new WebsiteExtractionError(
          "network_failure",
          "Website request failed.",
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === MAX_REDIRECTS) {
          throw new WebsiteExtractionError(
            "redirect_failure",
            location
              ? "Website exceeded the redirect limit."
              : "Website redirect had no location.",
          );
        }
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        throw new WebsiteExtractionError(
          "http_error",
          `Website returned HTTP ${response.status}.`,
        );
      }
      const contentType =
        response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ??
        "";
      if (!["text/html", "application/xhtml+xml"].includes(contentType)) {
        throw new WebsiteExtractionError(
          "invalid_content_type",
          "Website did not return HTML.",
        );
      }
      const metadata = extractMetadata(await readBoundedHtml(response));
      return {
        ok: true,
        data: { finalUrl: current.href, ...metadata },
      };
    }
    throw new WebsiteExtractionError(
      "redirect_failure",
      "Website exceeded the redirect limit.",
    );
  } catch (error) {
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