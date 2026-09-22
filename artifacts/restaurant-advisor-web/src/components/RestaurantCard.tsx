import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

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
    fetch(`/api/photo/${encodeURIComponent(id)}`)
      .then(res => res.json())
      .then(data => setPhotoUrl(data.url));
  }, [id]);

  return (
    <Link
      to={`/restaurant/${id}`}
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <img
          src={photoUrl || `https://source.unsplash.com/600x400/?restaurant,${city}`}
          alt={name}
          style={{
            width: "100%",
            height: "240px",
            objectFit: "cover",
            borderRadius: "16px"
          }}
        />

        <div style={{ fontSize: "1.2rem", fontWeight: 600 }}>{name}</div>
        <div style={{ opacity: 0.7 }}>{city} · {cuisine}</div>
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