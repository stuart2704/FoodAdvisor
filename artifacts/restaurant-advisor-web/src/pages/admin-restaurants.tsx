import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "../components/admin/AdminLayout";
import { RequireAdmin } from "../components/admin/RequireAdmin";

interface AdminRestaurant {
  placeId: string;
  name: string;
  city: string;
  region: string | null;
}

export default function ManageRestaurantsPage() {
  const [restaurants, setRestaurants] = useState<AdminRestaurant[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/dashboard/restaurants?page=1&limit=100", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success?: boolean;
          restaurants?: AdminRestaurant[];
          error?: string;
        };
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? "Restaurants could not be loaded.");
        }
        setRestaurants(payload.restaurants ?? []);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError")) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Restaurants could not be loaded.",
          );
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <RequireAdmin>
      <AdminLayout>
        <header style={{ marginBottom: "24px" }}>
          <p style={{ color: "#ff8b47", fontWeight: 700, margin: 0 }}>
            The Food Advisor Admin
          </p>
          <h1 style={{ margin: "6px 0 0" }}>Restaurant Ingestion</h1>
        </header>

        {error ? (
          <p style={{ color: "#ff9b8d" }} role="alert">
            {error}
          </p>
        ) : null}
        {!restaurants && !error ? <p>Loading restaurants…</p> : null}
        <ul
          style={{
            display: "grid",
            gap: "10px",
            margin: 0,
            padding: 0,
            listStyle: "none",
          }}
        >
          {restaurants?.map((restaurant) => (
            <li
              key={restaurant.placeId}
              style={{
                padding: "14px",
                border: "1px solid #303030",
                borderRadius: "9px",
                background: "#171717",
              }}
            >
              <strong>{restaurant.name}</strong>
              <span
                style={{
                  display: "block",
                  margin: "5px 0 9px",
                  color: "#999",
                }}
              >
                {restaurant.city}
                {restaurant.region ? `, ${restaurant.region}` : ""}
              </span>
              <Link
                to={`/restaurant/${encodeURIComponent(restaurant.placeId)}`}
                style={{ color: "#ff8b47" }}
              >
                View listing
              </Link>
            </li>
          ))}
        </ul>
      </AdminLayout>
    </RequireAdmin>
  );
}