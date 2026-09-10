import { launchBrowser } from "./playwrightClient";
import { logEvent, logError } from "../../dashboard/eventsFeed";
import { validateEmail } from "../../services/enrichment/validateEmail";

export interface BrowserWebsiteData {
  email: string | null;
  instagram: string | null;
  facebook: string | null;
  menuUrl: string | null;
  brandingQuality: "high" | "medium" | "low";
  brandingAssessment: "heuristic";
}

export function scoreBranding(html: string): BrowserWebsiteData["brandingQuality"] {
  const score = [/srcset\s*=/i, /menu/i, /font-family/i].filter((pattern) => pattern.test(html)).length;
  return score === 3 ? "high" : score === 2 ? "medium" : "low";
}

/** Parse actual link targets; do not invent /menu paths or social accounts. */
export function extractWebsiteSignals(html: string, finalUrl: string, links: string[]): BrowserWebsiteData {
  const base = new URL(finalUrl);
  const emailCandidates = [
    ...links.filter((link) => /^mailto:/i.test(link)),
    ...(html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? []).slice(0, 50),
  ];
  const email = emailCandidates.map((value) => validateEmail(value))
    .find((result) => result.status === "valid")?.email ?? null;
  const urls: URL[] = [];
  for (const link of links.slice(0, 500)) {
    try {
      const url = new URL(link, base);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) urls.push(url);
    } catch { /* Ignore malformed links without logging them. */ }
  }
  const social = (host: string) => urls.find((url) =>
    ["www." + host, host].includes(url.hostname.toLowerCase()) && url.pathname !== "/")?.href ?? null;
  return {
    email,
    instagram: social("instagram.com"),
    facebook: social("facebook.com"),
    menuUrl: urls.find((url) => url.origin === base.origin && /menu/i.test(url.pathname))?.href ?? null,
    brandingQuality: scoreBranding(html),
    brandingAssessment: "heuristic",
  };
}

export async function scrapeWebsite(
  url: string,
  options: { confirm?: boolean } = {},
): Promise<BrowserWebsiteData> {
  if (options.confirm !== true) throw new Error("Browser website scan confirmation is required.");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
  } catch { throw new Error("The guarded browser requires an HTTPS website URL without credentials."); }
  logEvent("Browser website extraction started");
  let session: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  try {
    session = await launchBrowser("website");
    const page = await session.context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!response?.ok()) throw new Error("Website navigation failed.");
    const html = await page.content();
    if (Buffer.byteLength(html, "utf8") > 512000) throw new Error("Website content too large.");
    const links = await page.evaluate(
      `Array.from(document.querySelectorAll('a[href]')).slice(0,500).map(a => a.getAttribute('href').slice(0,2048))`,
    ) as string[];
    const data = extractWebsiteSignals(html, page.url(), links);
    logEvent("Browser website extraction finished");
    return data;
  } catch {
    logError("Browser website extraction failed", "website_scrape_error");
    throw new Error("Browser website extraction could not be completed.");
  } finally {
    if (session) {
      try { await session.browser.close(); }
      catch { throw new Error("Browser session cleanup failed."); }
    }
  }
}