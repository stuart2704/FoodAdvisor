import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import RestaurantCard from "./RestaurantCard";

interface HighlightRestaurant {
  membershipId: string;
  id: string;
  name: string;
  city: string;
  cuisine: string | null;
  rating: number | null;
  premium: boolean;
}

interface RestaurantCollection {
  id: string;
  title: string;
  description: string;
  city: string;
  restaurants: HighlightRestaurant[];
}

interface CollectionsResponse {
  success: boolean;
  data?: RestaurantCollection[];
  error?: string;
}

export default function CityHighlights() {
  const [collections, setCollections] = useState<RestaurantCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "City Highlights | The Food Advisor";
    const controller = new AbortController();

    void fetch("/api/collections", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as CollectionsResponse;
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? "City highlights are unavailable.");
        }
        setCollections(payload.data);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError")) {
          setError(
            failure instanceof Error
              ? failure.message
              : "City highlights are unavailable.",
          );
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  return (
    <main className="public-page">
      <header className="public-page__hero">
        <p className="public-page__eyebrow">Curator picks</p>
        <h1>City highlights</h1>
        <p>Trusted local collections of restaurants worth planning a meal around.</p>
        <Link to="/highlights/manage" style={{ color: "#fff", textDecoration: "underline" }}>Manage highlights (curators)</Link>
      </header>

      <div className="public-page__content">
        {loading && <p>Loading city highlights…</p>}
        {error && (
          <p role="alert" style={{ color: "#ff8a80" }}>
            {error}
          </p>
        )}
        {!loading && !error && collections.length === 0 && (
          <section className="public-page__card">
            <h2>No collections yet</h2>
            <p>Our trusted curators are preparing the first city highlights.</p>
          </section>
        )}

        {!loading &&
          !error &&
          collections.map((collection) => (
            <section key={collection.id} style={{ marginBottom: "64px" }}>
              <p className="public-page__eyebrow">{collection.city}</p>
              <h2 style={{ fontSize: "2rem", marginBottom: "8px" }}>
                {collection.title}
              </h2>
              <p style={{ color: "#cfc7c2", maxWidth: "720px", lineHeight: 1.7 }}>
                {collection.description}
              </p>
              <div className="grid" style={{ marginTop: "28px" }}>
                {collection.restaurants.map((restaurant) => (
                  <RestaurantCard
                    key={restaurant.membershipId}
                    id={restaurant.id}
                    name={restaurant.name}
                    city={restaurant.city}
                    cuisine={restaurant.cuisine}
                  />
                ))}
              </div>
            </section>
          ))}
      </div>
    </main>
  );
}