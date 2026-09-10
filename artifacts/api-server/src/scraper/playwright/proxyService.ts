import { randomInt } from "node:crypto";
import { isIP } from "node:net";
import { isPrivateAddress } from "../../lib/public-url";

export type ProxyType = "maps" | "website";
export interface ProxyConfig {
  server: string;
  /** Compatibility alias; never log this or the authentication fields. */
  host: string;
  username?: string;
  password?: string;
}

/** Pure configuration parser; error messages never include supplied values. */
export function parseProxyPool(raw: string | undefined): ProxyConfig[] {
  if (!raw?.trim()) throw new Error("No scraper proxies configured.");
  try {
    if (raw.length > 65536) throw new Error("Oversized configuration.");
    const pool: unknown = JSON.parse(raw);
    if (!Array.isArray(pool) || pool.length === 0 || pool.length > 50) throw new Error("Invalid pool.");
    return pool.map((item: unknown): ProxyConfig => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid proxy.");
      const value = item as Record<string, unknown>;
      const host = value.server ?? value.host;
      if (typeof host !== "string" || !host.trim() || host.length > 2048) throw new Error("Invalid host.");
      const url = new URL(host.includes("://") ? host : `http://${host}`);
      const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
        || url.search || url.hash || url.pathname !== "/"
        || !hostname.includes(".") || hostname === "localhost" || hostname.endsWith(".localhost")
        || /\.(?:local|internal|test|invalid|example)$/.test(hostname)
        || /(?:^|\.)example\.(?:com|net|org)$/.test(hostname)
        || (isIP(hostname) && isPrivateAddress(hostname))) throw new Error("Disallowed proxy.");
      const hasAuth = value.username !== undefined || value.password !== undefined;
      if (hasAuth && (
        typeof value.username !== "string" || !value.username || value.username.length > 1024
        || typeof value.password !== "string" || !value.password || value.password.length > 1024
        || /[\r\n\u0000]/.test(value.username) || /[\r\n\u0000]/.test(value.password)
      )) throw new Error("Invalid authentication.");
      const server = url.origin;
      return {
        server, host: server,
        ...(hasAuth ? { username: value.username as string, password: value.password as string } : {}),
      };
    });
  } catch {
    throw new Error("Invalid scraper proxy configuration; use real HTTP(S) proxy servers and separate authentication fields.");
  }
}

/**
 * Configure JSON arrays in server-side secrets, never source code.
 * DNS/public-address checks also run at connection time in the guarded proxy.
 * No empty-pool or failed-proxy fallback to direct networking.
 */
export function getProxy(type: ProxyType): ProxyConfig {
  if (type !== "maps" && type !== "website") throw new Error("Unsupported scraper type.");
  const pool = parseProxyPool(type === "maps"
    ? process.env.SCRAPER_RESIDENTIAL_PROXIES
    : process.env.SCRAPER_DATACENTER_PROXIES);
  return { ...pool[randomInt(pool.length)] };
}