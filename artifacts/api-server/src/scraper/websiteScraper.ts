import {
  extractWebsiteData,
  type WebsiteExtractionErrorCode,
} from "../services/enrichment/extractWebsiteData";
import { logEvent } from "../utils/eventLog";

export interface WebsiteData {
  email?: string;
  // Reserved for verified extraction; never fabricate these optional values.
  menuUrl?: string;
  contactFormUrl?: string;
  instagram?: string;
  facebook?: string;
  tiktok?: string;
  brandingQuality?: string;
  priceLevel?: string;
}

export class WebsiteScrapeError extends Error {
  constructor(readonly code: WebsiteExtractionErrorCode | "unexpected_failure") {
    super(`Website extraction failed (${code}).`);
    this.name = "WebsiteScrapeError";
  }
}

/**
 * Read-only adapter to the bounded, private-network-protected extractor.
 * City scans already use this extractor through enrichRestaurant, which also
 * persists the results. Do not call both for the same enrichment attempt.
 */
export async function scrapeWebsiteDetails(url: string): Promise<WebsiteData> {
  logEvent("info", "Website scraper started");
  try {
    const result = await extractWebsiteData(url);
    if (!result.ok) throw new WebsiteScrapeError(result.error.code);
    const data: WebsiteData = {};
    if (result.data.roleEmail) data.email = result.data.roleEmail;
    logEvent("success", "Website scraper finished");
    return data;
  } catch (error) {
    const safeError = error instanceof WebsiteScrapeError
      ? error : new WebsiteScrapeError("unexpected_failure");
    logEvent("error", safeError.message);
    throw safeError;
  }
}