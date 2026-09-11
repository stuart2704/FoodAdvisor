"use client";

// Inactive draft in this Vite app; not connected to a live portal route.
// Draft status badges are previews, not proof of paid entitlement.
import { useEffect, useState } from "react";
import FeaturedBadge from "@/components/FeaturedBadge";

export default function PortalDashboard() {
  const [restaurant, setRestaurant] = useState(null);

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/restaurant");
      const data = await res.json();
      setRestaurant(data);
    };

    load();
  }, []);

  if (!restaurant) return <p>Loading…</p>;

  return (
    <div>
      <h1>
        {restaurant.name}
        {(restaurant.status === "upgraded_draft" || restaurant.status === "upgraded") && (
          <FeaturedBadge />
        )}
      </h1>

      <p>{restaurant.address}</p>
      <p>Status: {restaurant.status}</p>

      <div className="portal-actions">
        <a className="upgrade-button" href="/portal/listing">Edit Listing</a>
        <a className="upgrade-button" href="/portal/menu">Manage Menu</a>
        <a className="upgrade-button" href="/portal/analytics">View Analytics</a>
        <a className="upgrade-button" href="/portal/upgrade">Upgrade</a>
      </div>
    </div>
  );
}