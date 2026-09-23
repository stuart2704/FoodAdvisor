import RestaurantGrid from "../components/RestaurantGrid";
import PublicPage from "../components/PublicPage";

export default function RestaurantsPage() {
  return (
    <PublicPage
      eyebrow="Discover"
      title="Restaurants"
      description="Explore independent restaurants, local favourites, and places worth making a trip for."
    >
      <RestaurantGrid />
    </PublicPage>
  );
}