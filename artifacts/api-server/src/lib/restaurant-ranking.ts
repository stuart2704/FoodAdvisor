export const PREMIUM_NEARBY_BOOST_MILES = 1;

export function premiumAdjustedDistanceMiles(
  distanceMiles: number,
  premium: boolean,
): number {
  return Math.max(
    0,
    distanceMiles - (premium ? PREMIUM_NEARBY_BOOST_MILES : 0),
  );
}