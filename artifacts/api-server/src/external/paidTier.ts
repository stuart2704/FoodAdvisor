/** Non-binding suggestion; never grants access or changes a billing plan. */
export function paidTierRecommendation(
  restaurant: { rank: number },
): "enterprise" | "premium" | "plus" | "basic" {
  const score = restaurant.rank;
  if (!Number.isFinite(score) || score < 0) throw new Error("A valid restaurant rank is required.");
  if (score >= 90) return "enterprise";
  if (score >= 80) return "premium";
  if (score >= 60) return "plus";
  return "basic";
}