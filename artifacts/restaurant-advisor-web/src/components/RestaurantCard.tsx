import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import RestaurantPhoto from "./RestaurantPhoto";
import OsmAttribution from "./OsmAttribution";

type Coordinates = {
  lat: number;
  lng: number;
};

function distanceInKilometres(from: Coordinates, to: Coordinates) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.lat - from.lat);
  const longitudeDelta = toRadians(to.lng - from.lng);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export default function RestaurantCard({
  id,
  name,
  city,
  cuisine,
  openStatus,
  userLocation,
  location,
  score,
  reason
}: any) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setPhotoUrl(null);
    if (typeof id === "string" && id.startsWith("osm:")) {
      return () => controller.abort();
    }
    fetch(`/api/photo/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error("Restaurant photo unavailable");
        return res.json() as Promise<{ url?: unknown }>;
      })
      .then(data => setPhotoUrl(typeof data.url === "string" ? data.url : null))
      .catch(() => {
        if (!controller.signal.aborted) setPhotoUrl(null);
      });
    return () => controller.abort();
  }, [id]);

  return (
    <Link
      to={`/restaurant/${encodeURIComponent(id)}`}
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <RestaurantPhoto
          src={photoUrl}
          name={name}
          style={{
            width: "100%",
            height: "240px",
            borderRadius: "16px"
          }}
        />

        <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{name}</div>
        <div style={{ opacity: 0.7 }}>{city} · {cuisine}</div>
        {typeof id === "string" && id.startsWith("osm:") && <OsmAttribution />}
        {typeof score === "number" && (
          <div style={{ marginTop: "8px", fontWeight: 600 }}>
            🔥 Trending Score: {score}/100
          </div>
        )}
        {reason && (
          <div style={{ opacity: 0.7, fontSize: "0.9rem" }}>
            {reason}
          </div>
        )}
        {typeof openStatus?.[id] === "boolean" && (
          <div style={{ opacity: 0.7 }}>
            {openStatus[id] ? "🟢 Open Now" : "🔴 Closed"}
          </div>
        )}
        {userLocation && location && (
          <div style={{ opacity: 0.7 }}>
            {distanceInKilometres(userLocation, location).toFixed(1)} km away
          </div>
        )}
      </div>
    </Link>
  );
}