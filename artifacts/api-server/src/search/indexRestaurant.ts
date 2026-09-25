import { getRestaurantSearchClient, RESTAURANT_INDEX } from "./restaurantIndex";

export type IndexedRestaurant = {
  id: string;
  name: string;
  address: string;
  cuisine: string | null;
  rank: number;
  region: string | null;
};

/** Indexes a real listing, not an unverified external candidate. */
export async function indexRestaurant(restaurant: IndexedRestaurant): Promise<void> {
  if (!restaurant.id.trim() || !restaurant.name.trim() || !restaurant.address.trim()) {
    throw new Error("An indexed restaurant needs an ID, name, and address.");
  }
  if (!Number.isSafeInteger(restaurant.rank)) {
    throw new Error("An indexed restaurant needs an integer rank.");
  }

  await getRestaurantSearchClient().index({
    index: RESTAURANT_INDEX,
    id: restaurant.id,
    document: {
      name: restaurant.name,
      address: restaurant.address,
      cuisine: restaurant.cuisine,
      rank: restaurant.rank,
      region: restaurant.region,
    },
  });
}