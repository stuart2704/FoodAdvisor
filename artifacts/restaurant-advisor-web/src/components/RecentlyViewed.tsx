import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface RecentlyViewedRestaurant {
  id: string;
  name: string;
  city: string;
  image: string;
}

function isRecentlyViewedRestaurant(
  value: unknown
): value is RecentlyViewedRestaurant {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.city === "string" &&
    typeof item.image === "string"
  );
}

export default function RecentlyViewed() {
  const [items, setItems] = useState<RecentlyViewedRestaurant[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem("recentlyViewed") || "[]"
      ) as unknown;
      setItems(
        Array.isArray(stored)
          ? stored.filter(isRecentlyViewedRestaurant).slice(0, 10)
          : []
      );
    } catch {
      setItems([]);
    }
  }, []);

  if (items.length === 0) return null;

  return (
    <section
      style={{
        margin: "40px 24px 0",
        background: "#fff",
        padding: "24px",
        borderRadius: "16px"
      }}
    >
      <h2 style={{ marginBottom: "20px" }}>Recently Viewed</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
          gap: "16px"
        }}
      >
        {items.map((restaurant) => (
          <Link
            key={restaurant.id}
            to={`/restaurant/${restaurant.id}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div
              style={{
                height: "100%",
                background: "#fafafa",
                borderRadius: "12px",
                overflow: "hidden",
                boxShadow: "0 2px 6px rgba(0,0,0,0.1)"
              }}
            >
              {restaurant.image && (
                <img
                  src={restaurant.image}
                  alt={restaurant.name}
                  style={{
                    width: "100%",
                    height: "150px",
                    objectFit: "cover"
                  }}
                />
              )}
              <div style={{ padding: "12px" }}>
                <div style={{ fontWeight: 600 }}>{restaurant.name}</div>
                <div style={{ opacity: 0.7 }}>{restaurant.city}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}