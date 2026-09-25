import { restaurantScore, type RestaurantScoreInput } from "./restaurantScore";

/** Data-completeness ranking preview; not an approval or public search rank. */
export function restaurantRank(restaurant: RestaurantScoreInput): number {
  return restaurantScore(restaurant) + (restaurant.wheelchairAccessible ? 5 : 0);
}