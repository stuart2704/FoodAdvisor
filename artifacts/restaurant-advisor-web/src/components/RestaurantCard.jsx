// Draft preview only: do not use draft statuses to grant live paid benefits.
import FeaturedBadge from "./FeaturedBadge";

export default function RestaurantCard({ restaurant }) {
  const isFeatured =
    restaurant.status === "upgraded_draft" ||
    restaurant.status === "upgraded";

  return (
    <div className="restaurant-card">
      <h3>
        {restaurant.name}
        {isFeatured && <FeaturedBadge />}
      </h3>

      <p>{restaurant.address}</p>
    </div>
  );
}