import { lookup } from "node:dns/promises";
import { createServer, type Server as HttpServer } from "node:http";
import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import { isIP } from "node:net";
import { connect as tcpConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import type { ProxyConfig } from "./proxyService";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_UPSTREAM_HEADERS = 32 * 1024;
const DEFAULT_MAX_REQUESTS = 100;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

export const MAX_ACTIVE_SESSIONS = 2;

export interface GuardedProxyOptions {
  maxRequests?: number;
  maxBytes?: number;
  idleTimeoutMs?: number;
}

export interface GuardedProxy {
  /**
   * The loopback HTTP proxy URL intended for Playwright's `proxy.server`.
   * It must not be exposed outside of this process.
   */
  readonly url: string;
  readonly close: () => Promise<void>;
}

interface Endpoint {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
}

interface Destination {
  hostname: string;
  port: 80 | 443;
}

interface Meter {
  requests: number;
  bytes: number;
  closed: boolean;
}

interface ResolvedAddress {
  address: string;
  family: number;
}

type UpstreamSocket = Socket | TLSSocket;

interface EstablishmentCancellation {
  readonly promise: Promise<never>;
  readonly isCancelled: () => boolean;
  readonly cancel: () => void;
}

function createEstablishmentCancellation(): EstablishmentCancellation {
  let cancelled = false;
  let rejectCancellation!: (error: Error) => void;
  const promise = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  return {
    promise,
    isCancelled: () => cancelled,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      rejectCancellation(new Error("The guarded proxy is closing."));
    },
  };
}

/**
 * `public-url.ts` deliberately has a small shared predicate for its callers,
 * but a proxy boundary needs a complete IPv4 special-use policy.  In
 * particular, checking only the textual IPv4 form misses IPv4-mapped and
 * transition IPv6 addresses.  DNS is therefore queried for A records only,
 * and every answer still passes this conservative classifier.
 */
function isGloballyRoutableIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4
    || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) return false;

  const [a, b, c] = octets;
  return !(
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 2)
    || (a === 192 && b === 31 && c === 196)
    || (a === 192 && b === 52 && c === 193)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 192 && b === 175 && c === 48)
    || (a === 198 && b >= 18 && b <= 19)
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
  );
}

function genericProxyResponse(status: number, text: string): string {
  return [
    `HTTP/1.1 ${status} ${text}`,
    "Connection: close",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");
}

function authorityForIp(address: string): string {
  return isIP(address) === 6 ? `[${address}]` : address;
}

function parseConnectAuthority(raw: string): Destination | undefined {
  const value = raw.trim();
  const match = value.match(/^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/);
  if (!match) return undefined;
  const hostname = (match[1] ?? match[2] ?? "").trim();
  const port = Number(match[3]);
  if (!hostname || !Number.isInteger(port) || (port !== 80 && port !== 443)) return undefined;
  if (/[^\x21-\x7e]/.test(hostname) || hostname.includes("@")) return undefined;
  // Callers may provide a public IP literal, but allowing arbitrary IP
  // destinations makes the browser a general-purpose tunnel.  Destinations
  // must be named hosts; the resolved address is selected and pinned below.
  if (isIP(hostname) !== 0) return undefined;
  return { hostname, port: port as 80 | 443 };
}

function parseEndpoint(config: ProxyConfig): Endpoint {
  if (typeof config.server !== "string" || !config.server.trim()) {
    throw new Error("Scraper proxy server is invalid.");
  }

  let url: URL;
  try {
    url = new URL(config.server);
  } catch {
    throw new Error("Scraper proxy server is invalid.");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || !url.hostname
    || /[\r\n\u0000]/.test(config.server)
  ) {
    throw new Error("Scraper proxy server is invalid.");
  }
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) === 6) {
    throw new Error("Scraper proxy server is invalid.");
  }

  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:" ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Scraper proxy server is invalid.");
  }

  // `host` is intentionally checked as well as the URL host.  The proxy
  // service keeps this compatibility field separate so a malformed or
  // accidentally substituted host cannot silently become a direct target.
  if (typeof config.host !== "string" || !config.host.trim()) {
    throw new Error("Scraper proxy host is invalid.");
  }
  const configuredHost = config.host.trim();
  if (/[\r\n\u0000]/.test(configuredHost)) {
    throw new Error("Scraper proxy host is invalid.");
  }
  let hostUrl: URL;
  try {
    hostUrl = new URL(configuredHost.includes("://") ? configuredHost : `http://${configuredHost}`);
  } catch {
    throw new Error("Scraper proxy host is invalid.");
  }
  if (
    (hostUrl.protocol !== "http:" && hostUrl.protocol !== "https:")
    ||
    !hostUrl.hostname
    || hostUrl.username
    || hostUrl.password
    || hostUrl.pathname !== "/"
    || hostUrl.search
    || hostUrl.hash
    || hostUrl.hostname !== url.hostname
  ) {
    throw new Error("Scraper proxy host is invalid.");
  }

  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port,
  };
}

function basicProxyAuthorization(config: ProxyConfig): string | undefined {
  if (config.username === undefined && config.password === undefined) return undefined;
  if (
    typeof config.username !== "string"
    || typeof config.password !== "string"
    || !config.username
    || !config.password
    || /[\r\n\u0000]/.test(config.username)
    || /[\r\n\u0000]/.test(config.password)
  ) {
    throw new Error("Scraper proxy authentication is invalid.");
  }
  return `Basic ${Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")}`;
}

/**
 * Resolve all addresses and reject if even one answer is private or reserved.
 * The returned address is then used as a literal connection target.  This is
 * deliberately not an `http(s).request({ hostname })` call: Node would be
 * allowed to perform another DNS lookup after this check.
 */
async function resolvePublicAddress(
  hostname: string,
  cancellation?: EstablishmentCancellation,
): Promise<ResolvedAddress> {
  const cleanHostname = hostname.replace(/^\[|\]$/g, "").trim();
  if (!cleanHostname || /[\s/@\r\n\u0000]/.test(cleanHostname)) {
    throw new Error("A public network address is required.");
  }
  if (cancellation?.isCancelled()) {
    throw new Error("The guarded proxy is closing.");
  }

  let addresses: ResolvedAddress[];
  let timeout: NodeJS.Timeout | undefined;
  try {
    const resolution = lookup(cleanHostname, {
      all: true,
      verbatim: true,
      family: 4,
    }) as Promise<ResolvedAddress[]>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("DNS resolution timed out.")), CONNECT_TIMEOUT_MS);
    });
    addresses = await Promise.race([
      resolution,
      deadline,
      ...(cancellation ? [cancellation.promise] : []),
    ]);
  } catch {
    throw new Error("The network address could not be resolved.");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (
    addresses.length === 0
    || addresses.some(({ address, family }) => (
      family !== 4 || !address || !isGloballyRoutableIpv4(address)
    ))
  ) {
    throw new Error("The network address is not public.");
  }
  if (cancellation?.isCancelled()) {
    throw new Error("The guarded proxy is closing.");
  }
  return { address: addresses[0]!.address, family: 4 };
}

function makeSocketError(socket: UpstreamSocket): Error {
  // Do not include endpoint values: proxy configuration and destination URLs
  // must never enter diagnostics or an exception that could be logged.
  socket.destroy();
  return new Error("The upstream proxy connection failed.");
}

async function connectToUpstream(
  endpoint: Endpoint,
  tracked: Set<UpstreamSocket>,
  cancellation: EstablishmentCancellation,
): Promise<UpstreamSocket> {
  const resolved = await resolvePublicAddress(endpoint.hostname, cancellation);
  if (cancellation.isCancelled()) {
    throw new Error("The guarded proxy is closing.");
  }

  return new Promise<UpstreamSocket>((resolve, reject) => {
    let settled = false;
    const address = resolved.address;
    const socket = endpoint.protocol === "https:"
      ? tlsConnect({
        host: address,
        port: endpoint.port,
        servername: endpoint.hostname,
        rejectUnauthorized: true,
      })
      : tcpConnect({
        host: address,
        port: endpoint.port,
      });
    tracked.add(socket);
    if (cancellation.isCancelled()) {
      tracked.delete(socket);
      socket.destroy();
      reject(new Error("The guarded proxy is closing."));
      return;
    }
    socket.setTimeout(CONNECT_TIMEOUT_MS);

    const cleanup = () => {
      socket.removeListener("error", onError);
      socket.removeListener("timeout", onTimeout);
      socket.removeListener("connect", onTcpConnect);
      socket.removeListener("secureConnect", onTlsConnect);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      tracked.delete(socket);
      reject(makeSocketError(socket));
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.setTimeout(0);
      resolve(socket);
    };
    const onError = () => fail();
    const onTimeout = () => fail();
    const onTcpConnect = () => {
      if (endpoint.protocol === "http:") succeed();
    };
    const onTlsConnect = () => {
      if (endpoint.protocol === "https:") succeed();
    };

    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    if (endpoint.protocol === "https:") {
      (socket as TLSSocket).once("secureConnect", onTlsConnect);
    } else {
      socket.once("connect", onTcpConnect);
    }
  });
}

interface ProxyHeaderResponse {
  statusCode: number;
  remainder: Buffer;
}

async function readProxyHeaders(socket: UpstreamSocket): Promise<ProxyHeaderResponse> {
  return new Promise<ProxyHeaderResponse>((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let settled = false;
    socket.setTimeout(CONNECT_TIMEOUT_MS);

    const finish = (error?: Error, result?: ProxyHeaderResponse) => {
      if (settled) return;
      settled = true;
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("timeout", onTimeout);
      socket.setTimeout(0);
      socket.pause();
      if (error) reject(error);
      else resolve(result!);
    };
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_UPSTREAM_HEADERS) {
        finish(new Error("The upstream proxy response was too large."));
        socket.destroy();
        return;
      }
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const headerText = buffer.subarray(0, end).toString("latin1");
      const firstLine = headerText.split("\r\n", 1)[0] ?? "";
      const match = firstLine.match(/^HTTP\/\d\.\d\s+(\d{3})(?:\s|$)/);
      if (!match) {
        finish(new Error("The upstream proxy response was invalid."));
        socket.destroy();
        return;
      }
      finish(undefined, {
        statusCode: Number(match[1]),
        remainder: buffer.subarray(end + 4),
      });
    };
    const onError = () => finish(new Error("The upstream proxy connection failed."));
    const onTimeout = () => finish(new Error("The upstream proxy timed out."));

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.resume();
  });
}

async function establishTunnel(
  endpoint: Endpoint,
  config: ProxyConfig,
  destination: Destination,
  tracked: Set<UpstreamSocket>,
  cancellation: EstablishmentCancellation,
): Promise<{ socket: UpstreamSocket; remainder: Buffer }> {
  const destinationAddress = await resolvePublicAddress(destination.hostname, cancellation);
  if (cancellation.isCancelled()) {
    throw new Error("The guarded proxy is closing.");
  }
  const upstream = await connectToUpstream(endpoint, tracked, cancellation);
  if (cancellation.isCancelled()) {
    upstream.destroy();
    tracked.delete(upstream);
    throw new Error("The guarded proxy is closing.");
  }
  const target = `${authorityForIp(destinationAddress.address)}:${destination.port}`;
  const authorization = basicProxyAuthorization(config);
  const lines = [
    `CONNECT ${target} HTTP/1.1`,
    `Host: ${target}`,
    "Connection: keep-alive",
    ...(authorization ? [`Proxy-Authorization: ${authorization}`] : []),
    "",
    "",
  ];

  try {
    if (cancellation.isCancelled()) {
      throw new Error("The guarded proxy is closing.");
    }
    upstream.write(lines.join("\r\n"));
    const response = await readProxyHeaders(upstream);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      upstream.destroy();
      tracked.delete(upstream);
      throw new Error("The upstream proxy rejected the connection.");
    }
    return { socket: upstream, remainder: response.remainder };
  } catch (error) {
    upstream.destroy();
    tracked.delete(upstream);
    throw error instanceof Error ? error : new Error("The upstream proxy connection failed.");
  }
}

function bridgeSockets(
  client: Socket,
  upstream: UpstreamSocket,
  meter: Meter,
  maxBytes: number,
  idleTimeoutMs: number,
): void {
  let closed = false;
  const closeBoth = () => {
    if (closed) return;
    closed = true;
    client.destroy();
    upstream.destroy();
  };
  const count = (chunk: Buffer) => {
    meter.bytes += chunk.length;
    if (meter.bytes > maxBytes) closeBoth();
  };

  client.setTimeout(idleTimeoutMs, closeBoth);
  upstream.setTimeout(idleTimeoutMs, closeBoth);
  client.on("data", count);
  upstream.on("data", count);
  client.once("error", closeBoth);
  upstream.once("error", closeBoth);
  client.once("close", closeBoth);
  upstream.once("close", closeBoth);
  client.pipe(upstream);
  upstream.pipe(client);
}

function rejectConnect(socket: Socket, status = 403): void {
  if (socket.destroyed) return;
  socket.end(genericProxyResponse(status, status === 429 ? "Too Many Requests" : "Forbidden"));
}

/**
 * Starts a loopback-only HTTP gateway.  Every HTTPS connection is converted
 * to an upstream CONNECT whose authority is the already-validated destination
 * IP, not the caller-supplied hostname.
 *
 * Plain HTTP is intentionally rejected.  Supporting it with an upstream
 * proxy would require accepting and rewriting arbitrary request bodies; HTTPS
 * is the only supported scraping transport and explicit rejection prevents a
 * redirect from becoming an unguarded egress path.
 */
export async function createGuardedProxy(
  config: ProxyConfig,
  options: GuardedProxyOptions = {},
): Promise<GuardedProxy> {
  const endpoint = parseEndpoint(config);
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(maxRequests)
    || maxRequests < 1
    || !Number.isSafeInteger(maxBytes)
    || maxBytes < 1
    || !Number.isSafeInteger(idleTimeoutMs)
    || idleTimeoutMs < 1
  ) {
    throw new Error("Guarded proxy limits are invalid.");
  }

  const server: HttpServer = createServer((request, response) => {
    const meter = state.meter;
    if (state.closed || meter.requests >= maxRequests) {
      response.writeHead(429, { Connection: "close", "Content-Length": 0 });
      response.end();
      return;
    }
    meter.requests += 1;

    // A normal HTTP request is deliberately not forwarded.  In particular,
    // never pass its absolute URL to an upstream proxy that would resolve it.
    request.setTimeout(idleTimeoutMs, () => request.destroy());
    request.on("data", (chunk: Buffer) => {
      meter.bytes += chunk.length;
      if (meter.bytes > maxBytes) request.destroy();
    });
    request.resume();
    response.writeHead(501, { Connection: "close", "Content-Length": 0 });
    response.end();
  });
  const trackedSockets = new Set<Socket>();
  const trackedUpstream = new Set<UpstreamSocket>();
  const state: {
    closed: boolean;
    meter: Meter;
    closePromise?: Promise<void>;
    pendingEstablishments: Set<Promise<void>>;
    pendingCancellations: Set<EstablishmentCancellation>;
  } = {
    closed: false,
    meter: { requests: 0, bytes: 0, closed: false },
    pendingEstablishments: new Set(),
    pendingCancellations: new Set(),
  };

  server.on("connection", (socket) => {
    trackedSockets.add(socket);
    socket.once("close", () => trackedSockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("connect", (request, socket, head) => {
    // Node's HTTP typings expose the CONNECT socket as a Duplex even though
    // the server supplies a net.Socket at runtime.
    const client = socket as Socket;
    const cancellation = createEstablishmentCancellation();
    const establishment = (async () => {
      if (state.closed || state.meter.requests >= maxRequests) {
        rejectConnect(client, 429);
        return;
      }
      state.meter.requests += 1;
      client.pause();
      client.setTimeout(CONNECT_TIMEOUT_MS, () => client.destroy());

      const destination = parseConnectAuthority(request.url ?? "");
      if (!destination) {
        rejectConnect(client);
        return;
      }

      try {
        const tunnel = await establishTunnel(
          endpoint,
          config,
          destination,
          trackedUpstream,
          cancellation,
        );
        if (state.closed || client.destroyed) {
          tunnel.socket.destroy();
          trackedUpstream.delete(tunnel.socket);
          return;
        }
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (tunnel.remainder.length > 0) {
          state.meter.bytes += tunnel.remainder.length;
          if (state.meter.bytes > maxBytes) {
            client.destroy();
            tunnel.socket.destroy();
            return;
          }
          client.write(tunnel.remainder);
        }
        if (head.length > 0) {
          state.meter.bytes += head.length;
          if (state.meter.bytes > maxBytes) {
            client.destroy();
            tunnel.socket.destroy();
            return;
          }
          tunnel.socket.write(head);
        }
        trackedUpstream.delete(tunnel.socket);
        bridgeSockets(client, tunnel.socket, state.meter, maxBytes, idleTimeoutMs);
      } catch {
        rejectConnect(client);
      }
    })();
    state.pendingEstablishments.add(establishment);
    state.pendingCancellations.add(cancellation);
    void establishment.then(
      () => {
        state.pendingEstablishments.delete(establishment);
        state.pendingCancellations.delete(cancellation);
      },
      () => {
        state.pendingEstablishments.delete(establishment);
        state.pendingCancellations.delete(cancellation);
      },
    );
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host: LOOPBACK_HOST, port: 0 });
    });
  } catch (error) {
    state.closed = true;
    state.meter.closed = true;
    for (const cancellation of state.pendingCancellations) cancellation.cancel();
    for (const socket of trackedSockets) socket.destroy();
    for (const socket of trackedUpstream) socket.destroy();
    await Promise.allSettled(state.pendingEstablishments);
    for (const socket of trackedSockets) socket.destroy();
    for (const socket of trackedUpstream) socket.destroy();
    throw error instanceof Error ? error : new Error("The guarded proxy could not start.");
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    state.closed = true;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("The guarded proxy could not start.");
  }

  const close = async (): Promise<void> => {
    if (state.closePromise) return state.closePromise;
    state.closePromise = (async () => {
      state.closed = true;
      state.meter.closed = true;
      for (const cancellation of state.pendingCancellations) cancellation.cancel();
      for (const socket of trackedSockets) socket.destroy();
      for (const socket of trackedUpstream) socket.destroy();
      await Promise.allSettled(state.pendingEstablishments);
      // A task may have completed a cancellation phase while the first sweep
      // was running. Sweep again before reporting close completion.
      for (const socket of trackedSockets) socket.destroy();
      for (const socket of trackedUpstream) socket.destroy();
      await new Promise<void>((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    })();
    return state.closePromise;
  };

  return {
    url: `http://${LOOPBACK_HOST}:${address.port}`,
    close,
  };
}

// A descriptive alias makes the lifecycle boundary easier to discover for
// callers that do not need to know the implementation's local naming.
export const startGuardedProxy = createGuardedProxy;

export function isExecutableFile(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}