import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const directory = path.dirname(fileURLToPath(import.meta.url));

/*
 * These tests bundle the production modules with only the DNS, TCP connector,
 * proxy configuration, and Playwright launcher replaced.  The HTTP listener
 * and the client sockets remain Node's real local implementations.  No test
 * hostname is resolved by the host, and the connector fixture redirects the
 * production gateway's pinned test address to a local fake upstream.
 */
async function bundle(entry, mocks = {}) {
  const result = await build({
    stdin: {
      contents: entry,
      resolveDir: directory,
      sourcefile: "offline-test-entry.ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "offline-production-dependencies",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          // Imports from a fixture must always use the real Node builtin.
          if (args.namespace === "fixture" && args.path.startsWith("node:")) {
            return { path: args.path, external: true };
          }
          const suffix = Object.keys(mocks).find((value) => args.path.endsWith(value));
          return suffix ? { path: suffix, namespace: "fixture" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: mocks[args.path],
          loader: "js",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const dnsFixture = String.raw`
export async function lookup(hostname, options) {
  const calls = globalThis.__offlineDnsCalls ??= [];
  calls.push({ hostname, options });
  if (globalThis.__offlineDnsDelayHost === hostname) {
    await globalThis.__offlineDnsDelay;
  }
  const records = globalThis.__offlineDnsRecords ?? {};
  const result = records[hostname];
  if (!result) throw new Error("offline fixture: unexpected DNS lookup");
  return result.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));
}
`;

const netFixture = String.raw`
import { connect as realConnect, isIP as realIsIP } from "node:net";
export const isIP = realIsIP;
export function connect(options) {
  (globalThis.__offlineConnectCalls ??= []).push(options);
  const redirect = globalThis.__offlineConnectRedirect;
  if (redirect && options && options.host === redirect.address) {
    return realConnect({ ...options, host: "127.0.0.1", port: redirect.port });
  }
  return realConnect(options);
}
`;

let gatewayModule;
async function loadGatewayModule() {
  gatewayModule ??= await bundle('export * from "./guardedProxy.ts"', {
    "node:dns/promises": dnsFixture,
    "node:net": netFixture,
  });
  return gatewayModule;
}

function setDns(records) {
  globalThis.__offlineDnsRecords = records;
  globalThis.__offlineDnsCalls = [];
  globalThis.__offlineConnectCalls = [];
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

async function closeServer(server, sockets = []) {
  for (const socket of sockets) socket.destroy();
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function startFakeUpstream() {
  const records = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let buffered = Buffer.alloc(0);
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end < 0) return;
      const request = buffered.subarray(0, end).toString("latin1");
      records.push(request);
      socket.removeListener("data", onData);
      socket.write("HTTP/1.1 200 Connection Established\r\nConnection: keep-alive\r\n\r\n");
    };
    socket.on("data", onData);
  });
  const port = await listen(server);
  return {
    port,
    records,
    async close() {
      await closeServer(server, sockets);
    },
  };
}

function responseStatus(response) {
  return Number(response.match(/^HTTP\/\d\.\d\s+(\d{3})/m)?.[1] ?? 0);
}

async function connectToGateway(port, request) {
  const socket = net.connect(port, "127.0.0.1");
  let response = Buffer.alloc(0);
  let settled = false;
  let timer;
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener("error", onError);
      if (error) reject(error);
      else resolve({ socket, response: response.toString("latin1") });
    };
    const onError = (error) => finish(error);
    timer = setTimeout(() => finish(new Error("offline gateway response timed out")), 1_000);
    socket.once("error", onError);
    socket.on("data", (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (response.includes("\r\n\r\n")) finish();
    });
    socket.once("connect", () => socket.write(request));
    socket.once("close", () => {
      if (!settled) finish(new Error("offline gateway closed before responding"));
    });
  });
}

function waitFor(predicate, timeoutMs = 1_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        reject(new Error("offline condition timed out"));
        return;
      }
      setTimeout(poll, 5);
    };
    poll();
  });
}

async function waitForSocketClose(socket) {
  if (socket.destroyed) return;
  await once(socket, "close");
}

const proxyConfig = (port, host = "proxy.example") => ({
  server: `http://${host}:${port}`,
  host: `http://${host}:${port}`,
  username: "fixture-user",
  password: "fixture-password",
});

test("gateway rejects private, loopback, IPv6, mixed DNS, and private upstream answers", async () => {
  const gateway = await loadGatewayModule();
  const upstream = await startFakeUpstream();
  globalThis.__offlineConnectRedirect = { address: "8.8.8.8", port: upstream.port };
  setDns({
    "proxy.example": ["8.8.8.8"],
    "public.example": ["9.9.9.9"],
    "loopback.example": ["127.0.0.1"],
    "private.example": ["10.0.0.7"],
    "ipv6-loopback.example": ["::1"],
    "ipv6-private.example": ["fd12::7"],
    "mapped-answer.example": ["::ffff:127.0.0.1"],
    "translated-answer.example": ["64:ff9b::7f00:1"],
    "site-local-answer.example": ["fe80::1"],
    "zero-reserved.example": ["0.0.0.0"],
    "cgnat-reserved.example": ["100.64.0.1"],
    "benchmark-reserved.example": ["198.18.0.1"],
    "documentation-reserved.example": ["192.0.2.1"],
    "multicast-reserved.example": ["224.0.0.1"],
    "mixed.example": ["9.9.9.9", "192.168.1.7"],
    "private-proxy.example": ["127.0.0.1"],
  });

  const guarded = await gateway.createGuardedProxy(proxyConfig(upstream.port));
  try {
    const accepted = await connectToGateway(
      new URL(guarded.url).port,
      "CONNECT public.example:443 HTTP/1.1\r\n"
        + "Host: public.example:443\r\n"
        + "Proxy-Authorization: browser-must-not-leak\r\n\r\n",
    );
    assert.equal(responseStatus(accepted.response), 200);
    await waitFor(() => upstream.records.length === 1);
    assert.match(upstream.records[0], /^CONNECT 9\.9\.9\.9:443 HTTP\/1\.1/m);
    assert.match(upstream.records[0], /Host: 9\.9\.9\.9:443/);
    assert.match(
      upstream.records[0],
      /Proxy-Authorization: Basic Zml4dHVyZS11c2VyOmZpeHR1cmUtcGFzc3dvcmQ=/,
    );
    assert.doesNotMatch(upstream.records[0], /public\.example|browser-must-not-leak/);
    accepted.socket.destroy();

    for (const host of [
      "loopback.example",
      "private.example",
      "ipv6-loopback.example",
      "ipv6-private.example",
      "mapped-answer.example",
      "translated-answer.example",
      "site-local-answer.example",
      "zero-reserved.example",
      "cgnat-reserved.example",
      "benchmark-reserved.example",
      "documentation-reserved.example",
      "multicast-reserved.example",
      "mixed.example",
    ]) {
      const rejected = await connectToGateway(
        new URL(guarded.url).port,
        `CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`,
      );
      assert.equal(responseStatus(rejected.response), 403, host);
      rejected.socket.destroy();
    }

    // Public IP literals are not accepted as arbitrary tunnel destinations.
    const literal = await connectToGateway(
      new URL(guarded.url).port,
      "CONNECT 9.9.9.9:443 HTTP/1.1\r\nHost: 9.9.9.9:443\r\n\r\n",
    );
    assert.equal(responseStatus(literal.response), 403);
    literal.socket.destroy();
    assert.equal(upstream.records.length, 1);
    assert.ok(globalThis.__offlineDnsCalls.every(({ options }) => options.family === 4));

    for (const host of [
      "[::ffff:7f00:1]",
      "[64:ff9b::7f00:1]",
      "[fe80::1]",
      "[2001:db8::1]",
    ]) {
      const rejected = await connectToGateway(
        new URL(guarded.url).port,
        `CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`,
      );
      assert.equal(responseStatus(rejected.response), 403, host);
      rejected.socket.destroy();
    }

    const privateUpstream = await gateway.createGuardedProxy(
      proxyConfig(upstream.port, "private-proxy.example"),
    );
    try {
      const rejected = await connectToGateway(
        new URL(privateUpstream.url).port,
        "CONNECT public.example:443 HTTP/1.1\r\nHost: public.example:443\r\n\r\n",
      );
      assert.equal(responseStatus(rejected.response), 403);
      rejected.socket.destroy();
      assert.equal(upstream.records.length, 1);
    } finally {
      await privateUpstream.close();
    }
    for (const host of [
      "[::1]",
      "[::ffff:7f00:1]",
      "[64:ff9b::7f00:1]",
      "[fe80::1]",
    ]) {
      await assert.rejects(
        () => gateway.createGuardedProxy(proxyConfig(upstream.port, host)),
        /proxy server is invalid|proxy host is invalid/,
      );
    }
  } finally {
    await guarded.close();
    await upstream.close();
    delete globalThis.__offlineConnectRedirect;
  }
});

test("gateway explicitly rejects plain HTTP without DNS or upstream egress", async () => {
  const gateway = await loadGatewayModule();
  const upstream = await startFakeUpstream();
  globalThis.__offlineConnectRedirect = { address: "8.8.8.8", port: upstream.port };
  setDns({ "proxy.example": ["8.8.8.8"] });
  const guarded = await gateway.createGuardedProxy(proxyConfig(upstream.port));
  try {
    const response = await connectToGateway(
      new URL(guarded.url).port,
      "GET http://private.example/secret HTTP/1.1\r\nHost: private.example\r\n\r\n",
    );
    assert.equal(responseStatus(response.response), 501);
    assert.deepEqual(globalThis.__offlineDnsCalls, []);
    assert.equal(upstream.records.length, 0);
    response.socket.destroy();
  } finally {
    await guarded.close();
    await upstream.close();
    delete globalThis.__offlineConnectRedirect;
  }
});

test("gateway request, byte, idle-time caps and close cleanup are bounded", async () => {
  const gateway = await loadGatewayModule();
  const upstream = await startFakeUpstream();
  globalThis.__offlineConnectRedirect = { address: "8.8.8.8", port: upstream.port };
  setDns({
    "proxy.example": ["8.8.8.8"],
    "public.example": ["9.9.9.9"],
    "blocked.example": ["10.0.0.1"],
  });

  const requestLimited = await gateway.createGuardedProxy(proxyConfig(upstream.port), {
    maxRequests: 1,
  });
  try {
    const first = await connectToGateway(
      new URL(requestLimited.url).port,
      "CONNECT blocked.example:443 HTTP/1.1\r\nHost: blocked.example:443\r\n\r\n",
    );
    assert.equal(responseStatus(first.response), 403);
    first.socket.destroy();
    const second = await connectToGateway(
      new URL(requestLimited.url).port,
      "CONNECT blocked.example:443 HTTP/1.1\r\nHost: blocked.example:443\r\n\r\n",
    );
    assert.equal(responseStatus(second.response), 429);
    second.socket.destroy();
  } finally {
    await requestLimited.close();
  }

  const byteLimited = await gateway.createGuardedProxy(proxyConfig(upstream.port), {
    maxBytes: 1,
  });
  try {
    const connected = await connectToGateway(
      new URL(byteLimited.url).port,
      "CONNECT public.example:443 HTTP/1.1\r\nHost: public.example:443\r\n\r\n",
    );
    assert.equal(responseStatus(connected.response), 200);
    connected.socket.write("too-many-bytes");
    await waitForSocketClose(connected.socket);
  } finally {
    await byteLimited.close();
  }

  const timed = await gateway.createGuardedProxy(proxyConfig(upstream.port), {
    idleTimeoutMs: 20,
  });
  try {
    const connected = await connectToGateway(
      new URL(timed.url).port,
      "CONNECT public.example:443 HTTP/1.1\r\nHost: public.example:443\r\n\r\n",
    );
    assert.equal(responseStatus(connected.response), 200);
    await waitForSocketClose(connected.socket);
  } finally {
    const port = new URL(timed.url).port;
    await timed.close();
    const closed = await new Promise((resolve) => {
      const socket = net.connect(Number(port), "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(true);
      });
    });
    assert.equal(closed, true);
  }
  await upstream.close();
  delete globalThis.__offlineConnectRedirect;
});

test("gateway close cancels delayed DNS establishment before any upstream socket starts", async () => {
  const gateway = await loadGatewayModule();
  const upstream = await startFakeUpstream();
  globalThis.__offlineConnectRedirect = { address: "8.8.8.8", port: upstream.port };
  setDns({
    "proxy.example": ["8.8.8.8"],
    "public.example": ["9.9.9.9"],
  });
  globalThis.__offlineDnsDelayHost = "public.example";
  globalThis.__offlineDnsDelay = new Promise(() => {});
  const guarded = await gateway.createGuardedProxy(proxyConfig(upstream.port));
  const client = net.connect(Number(new URL(guarded.url).port), "127.0.0.1");
  client.on("error", () => {});
  client.once("connect", () => {
    client.write("CONNECT public.example:443 HTTP/1.1\r\nHost: public.example:443\r\n\r\n");
  });
  try {
    await waitFor(() => globalThis.__offlineDnsCalls.some(
      ({ hostname }) => hostname === "public.example",
    ));
    await guarded.close();
    assert.equal(globalThis.__offlineConnectCalls.length, 0);
    assert.equal(upstream.records.length, 0);
  } finally {
    client.destroy();
    delete globalThis.__offlineDnsDelayHost;
    delete globalThis.__offlineDnsDelay;
    await guarded.close();
    await upstream.close();
    delete globalThis.__offlineConnectRedirect;
  }
});

const launcherFixture = String.raw`
function state() { return globalThis.__offlineLauncherState; }
function makeContext() {
  const current = state();
  const context = {
    async route() {
      current.routes += 1;
      if (current.routeError) throw new Error("offline route failure");
    },
    async routeWebSocket() {
      current.websocketRoutes += 1;
      if (current.websocketRouteError) throw new Error("offline websocket route failure");
    },
    async close() { current.contextClosed += 1; },
  };
  current.context = context;
  return context;
}
function makeBrowser() {
  const current = state();
  let connected = true;
  let disconnected;
  const browser = {
    isConnected() { return connected; },
    once(event, handler) {
      if (event === "disconnected") disconnected = handler;
    },
    async newContext(options) {
      current.contextOptions = options;
      return makeContext();
    },
    async close() {
      if (!connected) return;
      connected = false;
      current.browserClosed += 1;
      if (disconnected) disconnected();
    },
  };
  current.browsers.push(browser);
  return browser;
}
export const chromium = {
  async launch(options) {
    const current = state();
    current.launches.push(options);
    if (current.launchError) throw new Error("offline launch failure");
    return makeBrowser();
  },
};
`;

const proxyServiceFixture = String.raw`
export function getProxy() {
  const current = globalThis.__offlineLauncherState;
  current.getProxyCalls += 1;
  if (current.proxyError) throw new Error("offline proxy missing");
  return { server: "http://offline.proxy:8080", host: "http://offline.proxy:8080" };
}
`;

const guardedProxyFixture = String.raw`
export const MAX_ACTIVE_SESSIONS = 2;
export function isExecutableFile() { return false; }
export async function createGuardedProxy() {
  const current = globalThis.__offlineLauncherState;
  current.gateways += 1;
  return {
    url: "http://127.0.0.1:1",
    async close() { current.gatewayClosed += 1; },
  };
}
`;

let launcherModule;
async function loadLauncherModule() {
  launcherModule ??= await bundle('export * from "./playwrightClient.ts"', {
    playwright: launcherFixture,
    "./proxyService": proxyServiceFixture,
    "./guardedProxy": guardedProxyFixture,
  });
  return launcherModule;
}

function resetLauncherState() {
  globalThis.__offlineLauncherState = {
    launches: [],
    browsers: [],
    gateways: 0,
    gatewayClosed: 0,
    getProxyCalls: 0,
    browserClosed: 0,
    contextClosed: 0,
    routes: 0,
    websocketRoutes: 0,
    contextOptions: undefined,
    context: undefined,
    proxyError: false,
    launchError: false,
    routeError: false,
    websocketRouteError: false,
  };
}

function withScrapingEnabled(value, callback) {
  const previous = process.env.BROWSER_SCRAPING_ENABLED;
  if (value === undefined) delete process.env.BROWSER_SCRAPING_ENABLED;
  else process.env.BROWSER_SCRAPING_ENABLED = value;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (previous === undefined) delete process.env.BROWSER_SCRAPING_ENABLED;
      else process.env.BROWSER_SCRAPING_ENABLED = previous;
    });
}

test("launcher blocks disabled or missing-proxy starts without browser/network calls", async () => {
  const launcher = await loadLauncherModule();
  resetLauncherState();
  await withScrapingEnabled(undefined, async () => {
    await assert.rejects(() => launcher.launchBrowser("maps"), /disabled/);
  });
  assert.equal(globalThis.__offlineLauncherState.launches.length, 0);
  assert.equal(globalThis.__offlineLauncherState.getProxyCalls, 0);
  assert.equal(launcher.activeBrowserSessions(), 0);

  resetLauncherState();
  globalThis.__offlineLauncherState.proxyError = true;
  await withScrapingEnabled("true", async () => {
    await assert.rejects(() => launcher.launchBrowser("website"), /proxy missing/);
  });
  assert.equal(globalThis.__offlineLauncherState.launches.length, 0);
  assert.equal(globalThis.__offlineLauncherState.gateways, 0);
  assert.equal(launcher.activeBrowserSessions(), 0);
});

test("launcher cleans gateway, browser, context, and slot on failed starts", async () => {
  const launcher = await loadLauncherModule();
  resetLauncherState();
  globalThis.__offlineLauncherState.websocketRouteError = true;
  await withScrapingEnabled("true", async () => {
    await assert.rejects(() => launcher.launchBrowser("maps"), /offline websocket route failure/);
  });
  assert.equal(globalThis.__offlineLauncherState.contextClosed, 1);
  assert.equal(globalThis.__offlineLauncherState.browserClosed, 1);
  assert.equal(globalThis.__offlineLauncherState.gatewayClosed, 1);
  assert.equal(launcher.activeBrowserSessions(), 0);

  resetLauncherState();
  globalThis.__offlineLauncherState.launchError = true;
  await withScrapingEnabled("true", async () => {
    await assert.rejects(() => launcher.launchBrowser("website"), /offline launch failure/);
  });
  assert.equal(globalThis.__offlineLauncherState.gateways, 1);
  assert.equal(globalThis.__offlineLauncherState.gatewayClosed, 1);
  assert.equal(launcher.activeBrowserSessions(), 0);
});

test("launcher applies offline-safe browser options and releases two session slots", async () => {
  const launcher = await loadLauncherModule();
  resetLauncherState();
  await withScrapingEnabled("true", async () => {
    const first = await launcher.launchBrowser("maps");
    const second = await launcher.launchBrowser("website");
    await assert.rejects(() => launcher.launchBrowser("maps"), /session limit/);

    const options = globalThis.__offlineLauncherState.launches[0];
    assert.equal(options.proxy.server, "http://127.0.0.1:1");
    assert.equal(options.headless, true);
    assert.ok(options.args.includes("--proxy-bypass-list=<-loopback>"));
    assert.ok(options.args.includes("--disable-quic"));
    assert.ok(options.args.includes("--force-webrtc-ip-handling-policy=disable_non_proxied_udp"));
    assert.deepEqual(globalThis.__offlineLauncherState.contextOptions, {
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      serviceWorkers: "block",
    });
    assert.equal(globalThis.__offlineLauncherState.routes, 2);
    assert.equal(globalThis.__offlineLauncherState.websocketRoutes, 2);
    assert.equal(launcher.activeBrowserSessions(), 2);

    await first.browser.close();
    await second.browser.close();
    await waitFor(() => globalThis.__offlineLauncherState.gatewayClosed === 2);
    assert.equal(launcher.activeBrowserSessions(), 0);
  });
});