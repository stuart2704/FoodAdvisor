// Draft preview only: draft upgrade statuses must not grant live paid benefits.
import FeaturedBadge from "./FeaturedBadge";

export default function DraftRestaurantHeading({ restaurant }) {
  return (
    <h1>
      {restaurant.name}
      {(restaurant.status === "upgraded_draft" || restaurant.status === "upgraded") && (
        <FeaturedBadge />
      )}
    </h1>
  );
}