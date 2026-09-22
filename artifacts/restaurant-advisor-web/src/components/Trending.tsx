import { useEffect, useState } from "react";
import RestaurantCard from "./RestaurantCard";

interface TrendingRestaurant {
  id: string;
  name: string;
  city: string;
  cuisine: string | null;
}

interface HomepageResponse {
  success: boolean;
  data?: {
    trending: TrendingRestaurant[];
  };
  error?: string;
}

export default function Trending() {
  const [trending, setTrending] = useState<TrendingRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Trending Restaurants | The Food Advisor";
    const controller = new AbortController();

    void fetch("/homepage", {
      signal: controller.signal,
      cache: "no-store"
    })
      .then(async (response) => {
        const payload = (await response.json()) as HomepageResponse;
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? "Trending restaurants are unavailable.");
        }
        setTrending(payload.data.trending);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError")) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Trending restaurants are unavailable."
          );
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  return (
    <main className="section" style={{ padding: "40px 24px" }}>
      <h1>Top Trending Restaurants</h1>
      <p>Ranked using verified popularity and listing signals.</p>

      {loading && <p style={{ marginTop: "30px" }}>Loading trending restaurants…</p>}
      {error && (
        <p role="alert" style={{ marginTop: "30px", color: "#b42318" }}>
          {error}
        </p>
      )}
      {!loading && !error && trending.length === 0 && (
        <p style={{ marginTop: "30px" }}>No trending restaurants are available yet.</p>
      )}

      {!loading && !error && trending.length > 0 && (
        <div
          style={{
            marginTop: "30px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "20px"
          }}
        >
          {trending.map((item) => (
            <RestaurantCard
              key={item.id}
              id={item.id}
              name={item.name}
              city={item.city}
              cuisine={item.cuisine}
            />
          ))}
        </div>
      )}
    </main>
  );
}