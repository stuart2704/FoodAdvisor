import { db, restaurantChefProfilesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export type SocialRestaurant = { name: string; city: string; cuisine?: string | null; rating?: number | null };
export async function selectMedia(restaurant?: { placeId: string }): Promise<string | null> {
  if (!restaurant) return null;
  const [profile] = await db.select({ path: restaurantChefProfilesTable.photoObjectPath })
    .from(restaurantChefProfilesTable)
    .where(and(eq(restaurantChefProfilesTable.restaurantId, restaurant.placeId), eq(restaurantChefProfilesTable.moderationStatus, "approved")));
  return profile?.path && /^https:\/\//i.test(profile.path) ? profile.path : null;
}
const verifiedTemplates = [
  "Today’s spotlight: {{dish_name}} — a {{flavour_profile}} masterpiece crafted with {{key_ingredients}}. Perfect for {{time_of_day}} cravings.",
  "Meet {{chef_name}}, the creative force behind {{restaurant_name}}. Their passion for {{cuisine}} shines in every dish.",
  "Craving something special? Try our {{menu_item}} — a customer favourite made with {{ingredients}}.",
  "“{{review_excerpt}}” — thank you for the love! We’re proud to serve {{cuisine}} to our amazing community.",
  "{{cuisine}} is trending globally — here’s our take on this flavourful movement.",
  "Today’s featured gem: {{restaurant_name}} — serving exceptional {{cuisine}} in {{location}}.",
  "Food tip of the day: {{tip}} — elevate your cooking instantly.",
  "{{cuisine}} is taking over the world — here’s why food lovers can’t get enough.",
  "Explore {{cuisine}} restaurants across {{city}} on The Food Advisor.",
  "Did you know? {{fact}} — food culture is evolving fast.",
];
/** Templates are intentionally only rendered when every value is explicitly approved. */
export function renderVerifiedTemplate(template: string, values: Record<string, string>, approved: Set<string>): string | null {
  const keys = [...template.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]);
  if (keys.some((key) => !approved.has(key) || !values[key]?.trim())) return null;
  if (/trending globally|taking over the world/.test(template) && !approved.has("trend_evidence")) return null;
  if (template.includes("customer favourite") && !approved.has("popularity_evidence")) return null;
  if (template.includes("review_excerpt") && !approved.has("review_reuse_permission")) return null;
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => values[key]);
}
export { verifiedTemplates };
export async function generateRestaurantPost(restaurant: SocialRestaurant & { placeId: string }) {
  const facts = [restaurant.name, restaurant.city, restaurant.cuisine].filter(Boolean).join(" · ");
  const values = {
    restaurant_name: restaurant.name,
    cuisine: restaurant.cuisine ?? "",
    location: restaurant.city,
  };
  const approved = new Set(["restaurant_name", "cuisine", "location"]);
  const featured = renderVerifiedTemplate(verifiedTemplates[5], values, approved);
  return { caption: featured ?? `${facts}. Discover more about this restaurant on The Food Advisor.`, media: await selectMedia(restaurant) };
}
export async function generateBrandPost() {
  return { caption: "Discover restaurants with The Food Advisor. Explore local listings and make your next dining choice with confidence.", media: null };
}