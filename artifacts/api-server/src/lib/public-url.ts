import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const CANONICAL_ORIGIN = "https://thefoodadvisor.co.uk";

function isPrivateIp(address: string): boolean {
  const normalised = address.toLowerCase().split("%")[0]!;
  if (!isIP(normalised)) return true;
  if (normalised.includes(":")) {
    // URL canonicalisation expands dotted IPv4-mapped addresses into hex hextets.
    const canonical = new URL(`http://[${normalised}]/`).hostname.slice(1, -1);
    const mapped = canonical.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
    if (mapped) {
      const high = Number.parseInt(mapped[1]!, 16);
      const low = Number.parseInt(mapped[2]!, 16);
      return isPrivateIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    // Only globally allocated unicast IPv6 is eligible; reject loopback,
    // link-local, ULA, multicast, documentation and transition ranges.
    const first = Number.parseInt(canonical.split(":")[0]!, 16);
    return !Number.isFinite(first) || first < 0x2000 || first > 0x3fff
      || canonical.startsWith("2001:db8:");
  }
  const [a, b, c] = normalised.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

export async function assertPublicHttpsUrl(
  raw: string | undefined,
  options: { canonical?: boolean } = {},
): Promise<URL> {
  if (!raw) throw new Error("PUBLIC_APP_URL must be explicitly configured.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PUBLIC_APP_URL must be a valid absolute URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("PUBLIC_APP_URL must be a bare HTTPS origin.");
  }
  if (options.canonical && url.origin !== CANONICAL_ORIGIN) {
    throw new Error(`PUBLIC_APP_URL must be the canonical ${CANONICAL_ORIGIN}.`);
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("PUBLIC_APP_URL must resolve only to public addresses.");
  }
  return url;
}

export function isPrivateAddress(address: string): boolean {
  return isPrivateIp(address.toLowerCase());
}