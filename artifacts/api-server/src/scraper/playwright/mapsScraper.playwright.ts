import type { Page } from "playwright";
import { launchBrowser } from "./playwrightClient";
import { logEvent, logError } from "../../dashboard/eventsFeed";
import { SUPPORTED_CITIES } from "../../lib/restaurant-import";

export interface MapsDiscovery {
  name: string;
  address: string;
  city: string;
  mapsUrl: string;
  placeId?: string;
  rating?: number;
  reviewsCount?: number;
  website?: string;
}

interface RawCard {
  name: string;
  address: string;
  rating: string;
  reviews: string;
  mapsUrl: string;
  website: string;
}

/** Extract only explicit Place IDs, never substitute a CID or a made-up ID. */
export function placeIdFromMapsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/(^|\.)google\.com$/.test(url.hostname)) return undefined;
    const id = url.searchParams.get("query_place_id")
      ?? url.searchParams.get("place_id")
      ?? url.searchParams.get("q")?.match(/^place_id:([A-Za-z0-9_-]+)$/)?.[1]
      ?? decodeURIComponent(url.pathname).match(/!1s(ChI[A-Za-z0-9_-]+)/)?.[1];
    return id && /^[A-Za-z0-9_-]{10,512}$/.test(id) ? id : undefined;
  } catch { return undefined; }
}

async function autoScroll(page: Page, maximum: number): Promise<void> {
  const feed = page.locator('[role="feed"]').first();
  await feed.waitFor({ state: "attached", timeout: 10000 });
  let unchanged = 0;
  for (let i = 0; i < 12 && unchanged < 3; i++) {
    if (await page.locator(".Nv2PK").count() >= maximum) break;
    const moved = await page.evaluate(`(() => {
      const feed = document.querySelector('[role="feed"]');
      if (!feed) return false;
      const before = feed.scrollTop;
      feed.scrollBy(0, 600);
      return feed.scrollTop !== before;
    })()`);
    unchanged = moved ? 0 : unchanged + 1;
    await page.waitForTimeout(400);
  }
}

/**
 * Opt-in browser discovery only. Does not insert, spend through the Places
 * API, bypass its budget, or promise a canonical ID for every Maps card.
 */
export async function scrapeMaps(
  city: string,
  options: { confirm?: boolean; maxResults?: number } = {},
): Promise<MapsDiscovery[]> {
  if (options.confirm !== true) throw new Error("Browser scan confirmation is required.");
  const canonicalCity = typeof city === "string"
    ? SUPPORTED_CITIES.find((item) => item.toLowerCase() === city.trim().toLowerCase()) : undefined;
  if (!canonicalCity) throw new Error("Unsupported city.");
  const maximum = options.maxResults ?? 20;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 20) {
    throw new Error("Browser Maps limit must be an integer from 1 to 20.");
  }
  logEvent("Browser Maps discovery started");
  let session: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  try {
    session = await launchBrowser("maps");
    const page = await session.context.newPage();
    const response = await page.goto(
      `https://www.google.com/maps/search/${encodeURIComponent(`restaurants in ${canonicalCity}`)}?hl=en`,
      { waitUntil: "domcontentloaded", timeout: 30000 },
    );
    if (!response?.ok()) throw new Error("Maps navigation failed.");
    await autoScroll(page, maximum);
    const raw = await page.evaluate(`Array.from(document.querySelectorAll('.Nv2PK')).slice(0,20).map(n => ({
      name: (n.querySelector('.qBF1Pd')?.textContent || '').trim().slice(0,500),
      address: (n.querySelector('[data-item-id="address"]')?.textContent || n.querySelector('[aria-label^="Address:"]')?.getAttribute('aria-label')?.replace(/^Address:\\s*/, '') || '').trim().slice(0,2000),
      rating: (n.querySelector('.MW4etd')?.textContent || '').trim().slice(0,30),
      reviews: (n.querySelector('.UY7F9')?.textContent || '').trim().slice(0,30),
      mapsUrl: (n.querySelector('a.hfpxzc')?.href || n.querySelector('a')?.href || '').slice(0,2048),
      website: (n.querySelector('a[data-value="Website"]')?.href || '').slice(0,2048)
    }))`) as RawCard[];
    const results: MapsDiscovery[] = [];
    const seen = new Set<string>();
    for (const item of raw.slice(0, maximum)) {
      if (!item.name || !item.mapsUrl) continue;
      const url = new URL(item.mapsUrl);
      if (url.protocol !== "https:" || !/(^|\.)google\.com$/.test(url.hostname)) continue;
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      const rating = Number(item.rating.replace(",", "."));
      const reviews = item.reviews.replace(/[(),\s]/g, "");
      const reviewsCount = /^\d+$/.test(reviews) ? Number(reviews) : undefined;
      const placeId = placeIdFromMapsUrl(url.href);
      let website: string | undefined;
      try {
        const parsed = new URL(item.website);
        if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) website = parsed.href;
      } catch { /* Missing website is allowed; never guess one. */ }
      results.push({
        name: item.name, address: item.address, city: canonicalCity, mapsUrl: url.href,
        ...(placeId ? { placeId } : {}),
        ...(item.rating && Number.isFinite(rating) && rating >= 0 && rating <= 5 ? { rating } : {}),
        ...(reviewsCount !== undefined && Number.isSafeInteger(reviewsCount) ? { reviewsCount } : {}),
        ...(website ? { website } : {}),
      });
    }
    logEvent(`Browser Maps discovery finished: ${results.length} candidates`);
    return results;
  } catch {
    logError("Browser Maps discovery failed; check proxy configuration, browser availability, or page layout", "maps_scrape_error");
    throw new Error("Browser Maps discovery could not be completed.");
  } finally {
    if (session) {
      try { await session.browser.close(); }
      catch { throw new Error("Browser session cleanup failed."); }
    }
  }
}