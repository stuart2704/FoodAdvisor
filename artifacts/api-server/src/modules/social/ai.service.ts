import { db, restaurantChefProfilesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export type SocialRestaurant = { name: string; city: string; cuisine?: string | null; rating?: number | null };
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
/** Only listing fields and approved chef names are eligible; no implied dish, review or trend claims. */
export function restaurantCaptions(restaurant: SocialRestaurant, chefName?: string | null): string[] {
  const name = restaurant.name.trim();
  const city = restaurant.city.trim();
  const cuisine = restaurant.cuisine?.trim();
  if (!name || !city) throw new Error("Restaurant name and city are required for a social draft.");
  const values = {
    restaurant_name: name, cuisine: cuisine ?? "", location: city,
    city, chef_name: chefName?.trim() ?? "",
  };
  const approved = new Set(["restaurant_name", "location", "city"]);
  if (cuisine) approved.add("cuisine");
  if (chefName?.trim()) approved.add("chef_name");
  const safeTemplates = [
    "Discover {{restaurant_name}} in {{location}} on The Food Advisor.",
    "{{restaurant_name}} is listed in {{city}}. Explore its listing on The Food Advisor.",
    "Looking for restaurants in {{city}}? Explore {{restaurant_name}} on The Food Advisor.",
    // Do not render the older templates: they claim exceptional quality, chef passion,
    // review permission, menu ingredients or trends not established by listing data.
    "Explore {{cuisine}} restaurants across {{city}} on The Food Advisor.",
    "{{restaurant_name}} · {{cuisine}} · {{city}}. Find out more on The Food Advisor.",
    "Get to know {{restaurant_name}} in {{city}} on The Food Advisor.",
    "Explore the listing for {{restaurant_name}} in {{city}}.",
    "Meet {{chef_name}} at {{restaurant_name}} in {{city}}. Explore the listing on The Food Advisor.",
  ];
  return safeTemplates.map((template) => renderVerifiedTemplate(template, values, approved))
    .filter((caption): caption is string => caption !== null);
}
export async function generateRestaurantPost(restaurant: SocialRestaurant & { placeId: string }, rotation = 0) {
  const [profile] = await db.select({
    name: restaurantChefProfilesTable.name,
    path: restaurantChefProfilesTable.photoObjectPath,
  }).from(restaurantChefProfilesTable)
    .where(and(eq(restaurantChefProfilesTable.restaurantId, restaurant.placeId), eq(restaurantChefProfilesTable.moderationStatus, "approved"))).limit(1);
  const captions = restaurantCaptions(restaurant, profile?.name);
  // Rotation is chosen by the caller and advances across drafts/UTC scheduled days.
  return { caption: captions[Math.abs(rotation) % captions.length]!, mediaObjectPath: profile?.path && /^\/objects\/chef\/[0-9a-f-]{36}$/.test(profile.path) ? profile.path : null };
}
export async function generateBrandPost() {
  return { caption: "Discover restaurants with The Food Advisor. Explore local listings and make your next dining choice with confidence.", mediaObjectPath: null };
}