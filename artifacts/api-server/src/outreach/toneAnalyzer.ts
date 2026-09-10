export type OutreachTone = "professional" | "friendly";

export function analyzeTone(restaurant: { brandingQuality?: string }): OutreachTone {
  const quality = restaurant.brandingQuality?.trim().toLowerCase();
  return quality === "high" || quality === "premium" ? "professional" : "friendly";
}