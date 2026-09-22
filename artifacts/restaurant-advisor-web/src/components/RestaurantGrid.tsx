import { useEffect, useState } from "react";
import RestaurantCard from "./RestaurantCard";
import SearchFilters from "./SearchFilters";

function distanceInKilometres(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.lat - from.lat);
  const longitudeDelta = toRadians(to.lng - from.lng);
  const fromLatitude = toRadians(from.lat);
  const toLatitude = toRadians(to.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export default function RestaurantGrid() {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [rating, setRating] = useState("");
  const [openNow, setOpenNow] = useState(false);
  const [openStatus, setOpenStatus] = useState<
    Record<string, boolean | null>
  >({});
  const [checkingOpenStatus, setCheckingOpenStatus] = useState(false);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [nearMe, setNearMe] = useState(false);
  const [radius, setRadius] = useState(5);
  const [locationError, setLocationError] = useState("");

  useEffect(() => {
    fetch("/api/restaurants")
      .then(res => res.json())
      .then(data => {
        setRestaurants(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("API error:", err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!openNow || restaurants.length === 0) {
      setCheckingOpenStatus(false);
      return;
    }

    const unchecked = restaurants.filter(
      (restaurant: any) => !(restaurant.id in openStatus)
    );
    if (unchecked.length === 0) {
      setCheckingOpenStatus(false);
      return;
    }

    let cancelled = false;
    let nextIndex = 0;
    setCheckingOpenStatus(true);

    async function worker() {
      while (!cancelled && nextIndex < unchecked.length) {
        const restaurant: any = unchecked[nextIndex++];
        try {
          const response = await fetch(
            `/api/open/${encodeURIComponent(restaurant.id)}`
          );
          if (!response.ok) {
            throw new Error("Opening status is unavailable.");
          }
          const data = await response.json();
          if (!cancelled) {
            setOpenStatus(prev => ({
              ...prev,
              [restaurant.id]:
                typeof data.openNow === "boolean" ? data.openNow : null
            }));
          }
        } catch {
          if (!cancelled) {
            setOpenStatus(prev => ({
              ...prev,
              [restaurant.id]: null
            }));
          }
        }
      }
    }

    void Promise.all(
      Array.from({ length: Math.min(4, unchecked.length) }, () => worker())
    ).finally(() => {
      if (!cancelled) {
        setCheckingOpenStatus(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [openNow, restaurants]);

  if (loading) {
    return <div className="section">Loading restaurants…</div>;
  }

  function findRestaurantsNearMe() {
    if (!navigator.geolocation) {
      setLocationError("Location services are not supported by this browser.");
      return;
    }

    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setNearMe(true);
      },
      () => {
        setNearMe(false);
        setLocationError(
          "We could not access your location. Check your browser permission and try again."
        );
      },
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 5 * 60 * 1000
      }
    );
  }

  const filtered = restaurants.filter((r: any) => {
    const matchesSearch =
      r.name.toLowerCase().includes(search.toLowerCase());

    const matchesCity =
      city === "" || r.city === city;

    const matchesCuisine =
      cuisine === "" || r.types?.includes(cuisine);

    const matchesRating =
      rating === "" || r.rating >= parseFloat(rating);

    const matchesOpenNow =
      !openNow || openStatus[r.id] === true;

    const restaurantLat =
      typeof r.location?.lat === "number" ? r.location.lat : r.lat;
    const restaurantLng =
      typeof r.location?.lng === "number" ? r.location.lng : r.lng;
    const hasCoordinates =
      typeof restaurantLat === "number" && typeof restaurantLng === "number";
    const matchesNearMe =
      !nearMe ||
      (userLocation !== null &&
        hasCoordinates &&
        distanceInKilometres(userLocation, {
          lat: restaurantLat,
          lng: restaurantLng
        }) <= radius);

    return (
      matchesSearch &&
      matchesCity &&
      matchesCuisine &&
      matchesRating &&
      matchesOpenNow &&
      matchesNearMe
    );
  });

  if (nearMe && userLocation) {
    filtered.sort((a: any, b: any) => {
      const aLat =
        typeof a.location?.lat === "number" ? a.location.lat : a.lat;
      const aLng =
        typeof a.location?.lng === "number" ? a.location.lng : a.lng;
      const bLat =
        typeof b.location?.lat === "number" ? b.location.lat : b.lat;
      const bLng =
        typeof b.location?.lng === "number" ? b.location.lng : b.lng;

      const distanceA = distanceInKilometres(userLocation, {
        lat: aLat,
        lng: aLng
      });
      const distanceB = distanceInKilometres(userLocation, {
        lat: bLat,
        lng: bLng
      });
      return distanceA - distanceB;
    });
  }

  return (
    <div className="section">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "12px",
          marginBottom: "20px"
        }}
      >
        <button
          onClick={findRestaurantsNearMe}
          style={{
            padding: "12px 20px",
            background: "#d94800",
            color: "#fff",
            borderRadius: "8px",
            border: "none",
            cursor: "pointer"
          }}
        >
          {nearMe ? "Update My Location" : "Find Restaurants Near Me"}
        </button>

        {nearMe && (
          <select
            value={radius}
            onChange={(e) => setRadius(parseInt(e.target.value, 10))}
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #ccc"
            }}
          >
            <option value={1}>Within 1 km</option>
            <option value={3}>Within 3 km</option>
            <option value={5}>Within 5 km</option>
            <option value={10}>Within 10 km</option>
            <option value={20}>Within 20 km</option>
          </select>
        )}
      </div>

      {locationError && (
        <p role="alert" style={{ color: "#9f2d00", marginTop: 0 }}>
          {locationError}
        </p>
      )}

      <SearchFilters
        search={search}
        setSearch={setSearch}
        city={city}
        setCity={setCity}
        cuisine={cuisine}
        setCuisine={setCuisine}
        rating={rating}
        setRating={setRating}
        openNow={openNow}
        setOpenNow={setOpenNow}
      />

      <div className="grid">
        {filtered.map((r: any) => (
          <RestaurantCard
            key={r.id}
            id={r.id}
            name={r.name}
            city={r.city}
            cuisine={r.types?.[0] || "Restaurant"}
            image={`https://source.unsplash.com/600x400/?restaurant,${r.city}`}
            openStatus={openStatus}
            userLocation={userLocation}
            location={
              typeof r.location?.lat === "number" &&
              typeof r.location?.lng === "number"
                ? r.location
                : typeof r.lat === "number" && typeof r.lng === "number"
                  ? { lat: r.lat, lng: r.lng }
                  : null
            }
          />
        ))}
      </div>

      {checkingOpenStatus && (
        <p style={{ textAlign: "center", opacity: 0.7 }}>
          Checking which restaurants are open…
        </p>
      )}

      {!checkingOpenStatus && filtered.length === 0 && (
        <p style={{ textAlign: "center", opacity: 0.7 }}>
          No restaurants match these filters.
        </p>
      )}
    </div>
  );
}