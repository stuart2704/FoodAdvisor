import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { isPrivateAddress } from "../lib/public-url";

const MAX_URL_LENGTH = 2_048;
const MAX_REDIRECTS = 4;
const HOP_TIMEOUT_MS = 3_000;
const TOTAL_TIMEOUT_MS = 8_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class BookingLinkError extends Error {
  constructor(
    public readonly code: "invalid_url" | "unsafe_url" | "redirect_abuse" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "BookingLinkError";
  }
}

function isRelatedHostname(original: string, destination: string): boolean {
  const first = original.toLowerCase();
  const second = destination.toLowerCase();
  return (
    first === second ||
    first.endsWith(`.${second}`) ||
    second.endsWith(`.${first}`)
  );
}

type ResolvedBookingUrl = {
  url: URL;
  addresses: Array<{ address: string; family: number }>;
};

async function assertSafeUrl(raw: string): Promise<ResolvedBookingUrl> {
  if (!raw || raw.length > MAX_URL_LENGTH) {
    throw new BookingLinkError("invalid_url", "Booking URL must be between 1 and 2,048 characters.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BookingLinkError("invalid_url", "Enter a valid HTTPS booking URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    isIP(url.hostname) ||
    !url.hostname.includes(".")
  ) {
    throw new BookingLinkError(
      "unsafe_url",
      "Booking links must use HTTPS on a public hostname without credentials or a custom port.",
    );
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new BookingLinkError("unavailable", "The booking hostname could not be resolved.");
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new BookingLinkError("unsafe_url", "The booking hostname is not public.");
  }
  return { url, addresses };
}

function requestPinned(
  url: URL,
  addresses: Array<{ address: string; family: number }>,
  timeoutMs: number,
): Promise<{ status: number; location: string | null }> {
  const selected = addresses[0]!;
  return new Promise((resolve, reject) => {
    const outbound = request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          Range: "bytes=0-0",
          "User-Agent": "TheFoodAdvisorBookingVerifier/1.0",
        },
        lookup(_hostname, _options, callback) {
          callback(null, selected.address, selected.family as 4 | 6);
        },
      },
      (response) => {
        const rawLocation = response.headers.location;
        const location = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
        const status = response.statusCode ?? 0;
        response.destroy();
        resolve({ status, location: location ?? null });
      },
    );
    outbound.setTimeout(timeoutMs, () => {
      outbound.destroy(new Error("Booking link verification timed out."));
    });
    outbound.on("error", reject);
    outbound.end();
  });
}

export async function verifyBookingLink(raw: string): Promise<string> {
  const startedAt = Date.now();
  let resolved = await assertSafeUrl(raw.trim());
  const originalHostname = resolved.url.hostname;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    resolved = await assertSafeUrl(resolved.url.href);
    if (!isRelatedHostname(originalHostname, resolved.url.hostname)) {
      throw new BookingLinkError(
        "redirect_abuse",
        "The booking link redirects to an unrelated website and cannot be approved.",
      );
    }
    const remainingMs = TOTAL_TIMEOUT_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new BookingLinkError("unavailable", "Booking link verification timed out.");
    }
    let response: { status: number; location: string | null };
    try {
      response = await requestPinned(
        resolved.url,
        resolved.addresses,
        Math.min(HOP_TIMEOUT_MS, remainingMs),
      );
    } catch {
      throw new BookingLinkError("unavailable", "The booking link could not be reached.");
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.location;
      if (!location || redirects === MAX_REDIRECTS) {
        throw new BookingLinkError(
          "redirect_abuse",
          location ? "The booking link has too many redirects." : "The booking redirect is invalid.",
        );
      }
      resolved = await assertSafeUrl(new URL(location, resolved.url).href);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new BookingLinkError("unavailable", "The booking page did not return a successful response.");
    }
    return resolved.url.href;
  }
  throw new BookingLinkError("redirect_abuse", "The booking link has too many redirects.");
}