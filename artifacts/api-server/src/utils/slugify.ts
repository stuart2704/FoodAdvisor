import { createHash } from "node:crypto";

export const slugify = (text: unknown): string =>
  String(text)
    .toLocaleLowerCase("en-GB")
    .trim()
    .replace(/[\s\W-]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function restaurantSlug(name: string, placeId: string): string {
  const suffix = createHash("sha256").update(placeId).digest("hex").slice(0, 10);
  return `${slugify(name) || "restaurant"}-${suffix}`;
}