import Hero from "./Hero";
import RecentlyViewed from "./RecentlyViewed";
import RestaurantGrid from "./RestaurantGrid";

export default function Home() {
  return (
    <>
      <Hero />
      <RestaurantGrid />
      <RecentlyViewed />
    </>
  );
}