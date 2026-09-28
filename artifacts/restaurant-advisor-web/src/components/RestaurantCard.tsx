import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import RestaurantPhoto from "./RestaurantPhoto";
import OsmAttribution from "./OsmAttribution";
import PhotoAttribution, { type PlacePhoto } from "./PhotoAttribution";

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
  const [photo, setPhoto] = useState<PlacePhoto | null>(null);
  const [visible, setVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisible(false);
    const element = cardRef.current;
    if (!element || typeof id !== "string") return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "100px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [id]);

  useEffect(() => {
    setPhoto(null);
    if (!visible || typeof id !== "string") return;
    const controller = new AbortController();
    fetch(`/api/photo/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error("Restaurant photo unavailable");
        return res.json() as Promise<{ url?: unknown; attribution?: PlacePhoto["attribution"] }>;
      })
      .then(data => {
        if (!controller.signal.aborted) setPhoto(typeof data.url === "string"
          ? { url: data.url, attribution: Array.isArray(data.attribution) ? data.attribution : [] }
          : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhoto(null);
      });
    return () => controller.abort();
  }, [id, visible]);

  return (
    <div ref={cardRef} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Link
        to={`/restaurant/${encodeURIComponent(id)}`}
        style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", gap: "12px" }}
      >
        <RestaurantPhoto
          src={photo?.url}
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
      </Link>
      {photo && <PhotoAttribution attribution={photo.attribution} />}
    </div>
  );
}