import { useState } from "react";
import RestaurantCard from "./RestaurantCard";

interface CityRestaurant {
  id: string;
  name: string;
  city: string;
  cuisine: string | null;
}

interface CityGuideData {
  city: string;
  country: string;
  restaurantCount: number;
  top: CityRestaurant[];
  trending: CityRestaurant[];
  premium: CityRestaurant[];
  cuisineSections: Record<string, CityRestaurant[]>;
}

function RestaurantSection({
  title,
  restaurants
}: {
  title: string;
  restaurants: CityRestaurant[];
}) {
  if (restaurants.length === 0) return null;

  return (
    <section style={{ marginTop: "40px" }}>
      <h2>{title}</h2>
      <div
        style={{
          marginTop: "20px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: "20px"
        }}
      >
        {restaurants.map((restaurant) => (
          <RestaurantCard
            key={restaurant.id}
            id={restaurant.id}
            name={restaurant.name}
            city={restaurant.city}
            cuisine={restaurant.cuisine}
          />
        ))}
      </div>
    </section>
  );
}

export default function CityGuide() {
  const [city, setCity] = useState("");
  const [guide, setGuide] = useState<CityGuideData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadGuide() {
    const normalizedCity = city.trim();
    if (!normalizedCity) {
      setError("Enter a city name.");
      return;
    }

    setLoading(true);
    setError("");
    setGuide(null);

    try {
      const response = await fetch(
        `/api/city/${encodeURIComponent(normalizedCity)}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        success?: boolean;
        data?: CityGuideData;
        error?: string;
      };
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? "The city guide is unavailable.");
      }
      setGuide(payload.data);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The city guide is unavailable."
      );
    } finally {
      setLoading(false);
    }
  }

  async function downloadGuide() {
    if (!guide) return;

    const { jsPDF } = await import("jspdf");
    const document = new jsPDF();
    const margin = 15;
    const pageWidth = document.internal.pageSize.getWidth();
    const pageHeight = document.internal.pageSize.getHeight();
    const contentWidth = pageWidth - margin * 2;
    let y = 20;

    const addText = (
      text: string,
      options: { size?: number; bold?: boolean; gapAfter?: number } = {}
    ) => {
      const size = options.size ?? 11;
      const lineHeight = size * 0.5;
      document.setFontSize(size);
      document.setFont("helvetica", options.bold ? "bold" : "normal");
      const lines = document.splitTextToSize(text, contentWidth) as string[];

      for (const line of lines) {
        if (y + lineHeight > pageHeight - margin) {
          document.addPage();
          y = 20;
        }
        document.text(line, margin, y);
        y += lineHeight;
      }
      y += options.gapAfter ?? 3;
    };

    const addRestaurantSection = (
      title: string,
      restaurants: CityRestaurant[]
    ) => {
      if (restaurants.length === 0) return;
      addText(title, { size: 15, bold: true, gapAfter: 4 });
      restaurants.forEach((restaurant, index) => {
        addText(
          `${index + 1}. ${restaurant.name} — ${
            restaurant.cuisine ?? "Restaurant"
          }, ${restaurant.city}`,
          { gapAfter: 2 }
        );
      });
      y += 3;
    };

    addText(`${guide.city} Food Guide`, {
      size: 20,
      bold: true,
      gapAfter: 5
    });
    addText(
      `${guide.restaurantCount} verified restaurant${
        guide.restaurantCount === 1 ? "" : "s"
      } in ${guide.city}, ${guide.country}.`,
      { gapAfter: 7 }
    );
    addRestaurantSection("Top Restaurants", guide.top);
    addRestaurantSection("Trending Restaurants", guide.trending);
    addRestaurantSection("Premium Dining", guide.premium);
    Object.entries(guide.cuisineSections).forEach(
      ([cuisine, restaurants]) => {
        addRestaurantSection(`${cuisine} Restaurants`, restaurants);
      }
    );

    const filenameCity = guide.city
      .toLocaleLowerCase("en-GB")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    document.save(`${filenameCity || "city"}-food-guide.pdf`);
  }

  return (
    <main className="section" style={{ padding: "40px 24px" }}>
      <h1>City Food Guide</h1>
      <p>Explore verified restaurant recommendations for any available city.</p>

      <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
        <input
          type="text"
          placeholder="Enter city name"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !loading) void loadGuide();
          }}
          style={{
            padding: "12px",
            width: "100%",
            borderRadius: "8px",
            border: "1px solid #ccc"
          }}
        />

        <button
          type="button"
          onClick={() => void loadGuide()}
          disabled={loading}
          style={{
            padding: "12px 20px",
            background: "#d94800",
            color: "#fff",
            borderRadius: "8px",
            border: "none",
            cursor: loading ? "wait" : "pointer",
            whiteSpace: "nowrap"
          }}
        >
          {loading ? "Loading…" : "View Guide"}
        </button>
      </div>

      {error && (
        <p role="alert" style={{ marginTop: "20px", color: "#b42318" }}>
          {error}
        </p>
      )}

      {guide && (
        <div style={{ marginTop: "40px" }}>
          <h2>
            {guide.city}, {guide.country}
          </h2>
          <p>
            {guide.restaurantCount} restaurant
            {guide.restaurantCount === 1 ? "" : "s"} available.
          </p>

          <button
            type="button"
            onClick={() => void downloadGuide()}
            style={{
              marginTop: "20px",
              padding: "12px 20px",
              background: "#333",
              color: "#fff",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer"
            }}
          >
            Download PDF
          </button>

          <RestaurantSection title="Top Restaurants" restaurants={guide.top} />
          <RestaurantSection
            title="Trending Restaurants"
            restaurants={guide.trending}
          />
          <RestaurantSection
            title="Premium Dining"
            restaurants={guide.premium}
          />

          {Object.entries(guide.cuisineSections).map(
            ([cuisine, restaurants]) => (
              <RestaurantSection
                key={cuisine}
                title={`${cuisine} Restaurants`}
                restaurants={restaurants}
              />
            )
          )}
        </div>
      )}
    </main>
  );
}