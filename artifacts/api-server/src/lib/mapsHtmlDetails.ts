import { load } from "cheerio";
import { classify } from "./restaurantKeywords";

/**
 * Parses a supplied HTML snapshot for inspection only. Google Maps may render
 * these selectors in the browser rather than in a fetched HTML response.
 * Body-text matches are unverified candidates; do not persist as venue facts.
 */
export function extractDetails(html: string) {
  const $ = load(html);
  const rawText = $("body").find("*").addBack().contents()
    .filter((_, node) => node.type === "text")
    .map((_, node) => $(node).text())
    .get()
    .join(" ")
    .toLowerCase();
  const { cuisines, amenities } = classify(rawText);
  const address = $("button[data-item-id='address']").first().text().trim() || null;
  const phone = $("button[data-item-id='phone']").first().text().trim() || null;
  const href = $("a[data-item-id='authority']").first().attr("href");
  const website = href && /^https?:\/\//i.test(href) ? href : null;
  const reviewText = $(".Yr7JMd").first().text().trim();
  const reviewDigits = reviewText.replace(/\D/g, "");
  const reviewCount = reviewDigits ? Number(reviewDigits) : null;
  const priceLevel = $(".mgrRtf").first().text().trim() || null;

  return {
    address,
    phone,
    website,
    review_count: Number.isSafeInteger(reviewCount) ? reviewCount : null,
    price_level: priceLevel,
    cuisines,
    amenities,
  };
}