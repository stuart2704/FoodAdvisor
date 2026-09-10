import { chromium, type Browser, type BrowserContext } from "playwright";
import { getProxy, type ProxyType } from "./proxyService";
import {
  createGuardedProxy,
  isExecutableFile,
  MAX_ACTIVE_SESSIONS,
  type GuardedProxy,
} from "./guardedProxy";

const DEFAULT_CHROMIUM_PATH = "/repl/tools/bin/chromium";
const MAX_BROWSER_LIFETIME_MS = 120_000;
const MAX_RESOURCE_REQUESTS = 100;

let activeSessions = 0;

function acquireSession(): () => void {
  if (activeSessions >= MAX_ACTIVE_SESSIONS) {
    throw new Error("The scraper browser session limit has been reached.");
  }
  activeSessions += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeSessions -= 1;
  };
}

function executablePath(): string | undefined {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (configured && isExecutableFile(configured)) return configured;
  if (isExecutableFile(DEFAULT_CHROMIUM_PATH)) return DEFAULT_CHROMIUM_PATH;
  // Let the official Playwright package use its bundled/default browser when
  // no explicitly installed Chromium is available.
  return undefined;
}

function browserArgs(): string[] {
  return [
    "--proxy-bypass-list=<-loopback>",
    "--disable-quic",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-features=WebRtcHideLocalIpsWithMdns",
    "--disable-dns-prefetch",
    "--disable-async-dns",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-sync",
  ];
}

export interface LaunchedBrowser {
  browser: Browser;
  context: BrowserContext;
}

/**
 * Launch an official Playwright Chromium instance behind a process-local
 * gateway.  The gateway, context, and session slot all share one cleanup
 * path so a partial launch cannot leave an egress proxy or active slot behind.
 */
export async function launchBrowser(type: ProxyType): Promise<LaunchedBrowser> {
  if (process.env.BROWSER_SCRAPING_ENABLED !== "true") {
    throw new Error("Browser scraping is disabled.");
  }

  const release = acquireSession();
  let gateway: GuardedProxy | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let timer: NodeJS.Timeout | undefined;
  let finalizePromise: Promise<void> | undefined;

  const finalize = async (closeBrowser: boolean): Promise<void> => {
    if (finalizePromise) return finalizePromise;
    finalizePromise = (async () => {
      if (timer) clearTimeout(timer);
      if (closeBrowser && browser?.isConnected()) {
        try {
          await browser.close();
        } catch {
          // Cleanup must continue even when Chromium has already disconnected.
        }
      }
      try {
        await gateway?.close();
      } finally {
        release();
      }
    })();
    return finalizePromise;
  };

  try {
    const config = getProxy(type);
    gateway = await createGuardedProxy(config);
    browser = await chromium.launch({
      headless: true,
      executablePath: executablePath(),
      proxy: { server: gateway.url },
      args: browserArgs(),
    });
    browser.once("disconnected", () => {
      void finalize(false).catch(() => undefined);
    });

    context = await browser.newContext({
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      serviceWorkers: "block",
    });

    let resourceRequests = 0;
    await context.route("**/*", async (route) => {
      const rawUrl = route.request().url();
      let protocol = "";
      try {
        protocol = new URL(rawUrl).protocol;
      } catch {
        await route.abort("blockedbyclient");
        return;
      }
      if (protocol !== "http:" && protocol !== "https:") {
        await route.abort("blockedbyclient");
        return;
      }
      resourceRequests += 1;
      if (resourceRequests > MAX_RESOURCE_REQUESTS) {
        await route.abort("blockedbyclient");
        return;
      }
      try {
        // All redirects are routed here again and continue through Chromium's
        // configured local proxy, where destination DNS is checked again.
        await route.continue();
      } catch {
        // A concurrent browser shutdown can invalidate a route; no fallback
        // request is permitted in that case.
        try {
          await route.abort("failed");
        } catch {
          // The route may already have been disposed by context shutdown.
        }
      }
    });
    await context.routeWebSocket("**/*", async (route) => {
      await route.close({ code: 1008, reason: "WebSocket access is disabled." });
    });

    timer = setTimeout(() => {
      void finalize(true).catch(() => undefined);
    }, MAX_BROWSER_LIFETIME_MS);
    timer.unref();

    return { browser, context };
  } catch (error) {
    if (context) {
      try {
        await context.close();
      } catch {
        // Continue closing the browser and gateway.
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Continue closing the gateway and releasing the session slot.
      }
    }
    await finalize(false);
    throw error;
  }
}

export function activeBrowserSessions(): number {
  return activeSessions;
}