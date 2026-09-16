export interface RankingSignals {
  premium: boolean;
  score: number | null;
  popularity: number | null;
  aiRelevanceBoost: number | null;
  city: string;
  country: string;
  cuisine: string | null;
}

function boundedSignal(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

const MAJOR_CITIES = new Set(
  ["London", "Manchester", "Cardiff", "New York", "Tokyo", "Paris"].map(
    (value) => value.toLocaleLowerCase("en-GB"),
  ),
);

const POPULAR_CUISINES = new Set(
  ["Italian", "Japanese", "Indian", "Chinese", "Mexican"].map((value) =>
    value.toLocaleLowerCase("en-GB"),
  ),
);

export function getGeoWeight(city: string, _country: string): number {
  return MAJOR_CITIES.has(city.trim().toLocaleLowerCase("en-GB")) ? 10 : 0;
}

export function getCuisineWeight(cuisine: string | null): number {
  return cuisine &&
    POPULAR_CUISINES.has(cuisine.trim().toLocaleLowerCase("en-GB"))
    ? 5
    : 0;
}

export function calculateRanking(signals: RankingSignals): number {
  const score = boundedSignal(signals.score);
  const popularity = boundedSignal(signals.popularity);
  const aiRelevanceBoost = boundedSignal(signals.aiRelevanceBoost);
  return Number(
    (
      (signals.premium ? 50 : 0) +
      score * 0.4 +
      popularity * 0.3 +
      aiRelevanceBoost * 0.3 +
      getGeoWeight(signals.city, signals.country) +
      getCuisineWeight(signals.cuisine)
    ).toFixed(2),
  );
}

export function rankRestaurants<T extends RankingSignals>(items: T[]): T[] {
  return [...items].sort(
    (left, right) =>
      calculateRestaurantRank(right) - calculateRestaurantRank(left),
  );
}

export const calculateRestaurantRank = calculateRanking;

export default {
  calculateRanking,
  calculateRestaurantRank,
  getGeoWeight,
  getCuisineWeight,
  rankRestaurants,
};