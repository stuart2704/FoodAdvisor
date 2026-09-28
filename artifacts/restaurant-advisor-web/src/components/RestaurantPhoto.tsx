import { useState, type CSSProperties } from "react";

const fallbackImage = `${import.meta.env.BASE_URL}restaurant-fallback.jpg`;

interface RestaurantPhotoProps {
  src?: string | null;
  name: string;
  style: CSSProperties;
}

export default function RestaurantPhoto({ src, name, style }: RestaurantPhotoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const photoSrc = typeof src === "string" && (src.startsWith("https://") || src.startsWith("/api/storage/objects/restaurant/")) ? src : null;
  const illustrative = !photoSrc || failedSrc === photoSrc;

  return (
    <div style={{ position: "relative", overflow: "hidden", background: "#24201d", ...style }}>
      <img
        src={illustrative ? fallbackImage : photoSrc}
        alt={illustrative ? `Illustrative restaurant image; photo of ${name} unavailable` : name}
        loading="lazy"
        onError={() => {
          if (photoSrc && !illustrative) setFailedSrc(photoSrc);
        }}
        style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
      />
      {illustrative && (
        <span
          style={{
            position: "absolute",
            bottom: 12,
            left: 12,
            padding: "5px 9px",
            borderRadius: 6,
            background: "rgba(0, 0, 0, 0.78)",
            color: "#fff",
            fontSize: "0.75rem",
            fontWeight: 600,
          }}
        >
          Illustrative image
        </span>
      )}
    </div>
  );
}