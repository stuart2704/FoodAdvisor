import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import RestaurantPhoto from "./RestaurantPhoto";
import OsmAttribution from "./OsmAttribution";
import { trackEvent } from "../lib/analytics";
import PhotoAttribution, { type PlacePhoto } from "./PhotoAttribution";

function formatPrice(level: string | null) {
  if (level === null) return "Not available";
  return (
    {
      PRICE_LEVEL_FREE: "Free",
      PRICE_LEVEL_INEXPENSIVE: "£",
      PRICE_LEVEL_MODERATE: "££",
      PRICE_LEVEL_EXPENSIVE: "£££",
      PRICE_LEVEL_VERY_EXPENSIVE: "££££"
    }[level] || "Not available"
  );
}

interface ChefProfile {
  name: string | null;
  bio: string | null;
  philosophy: string | null;
  photo: string | null;
  signatureDishes: string[];
  awards: string[];
  verifiedAt: string | null;
  status?: string;
}
export default function RestaurantDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [restaurant, setRestaurant] = useState<RestaurantData | null>(null);
  const [aiDescription, setAiDescription] = useState("");
  const [reviews, setReviews] = useState<any[]>([]);
  const [hours, setHours] = useState<string[]>([]);
  const [openNow, setOpenNow] = useState<boolean | null>(null);
  const [priceLevel, setPriceLevel] = useState<string | null>(null);
  const [primaryPhoto, setPrimaryPhoto] = useState<PlacePhoto | null>(null);
  const [gallery, setGallery] = useState<PlacePhoto[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const claimToken =
    searchParams.get("claimToken") || searchParams.get("token") || "";

  async function handleClaim() {
    if (!restaurant || !email.trim()) {
      window.alert("Enter your business email.");
      return;
    }
    if (!claimToken) {
      window.alert(
        "A secure claim link is required. Please use the link sent to the restaurant's business email."
      );
      return;
    }

    setClaimSubmitting(true);
    try {
      const response = await fetch(
        `/api/restaurants/${encodeURIComponent(restaurant.id)}/claim`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            claimToken
          })
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "The claim could not be submitted.");
      }
       setRestaurant((current) => current ? { ...current, claimed: true } : current);
      window.alert("Your restaurant claim has been verified.");
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "The claim could not be submitted."
      );
    } finally {
      setClaimSubmitting(false);
    }
  }

  useEffect(() => {
    if (!id) return;

    fetch(`/api/restaurant/${encodeURIComponent(id)}`)
      .then(res => {
        if (!res.ok) {
          throw new Error("Restaurant details are unavailable.");
        }
        return res.json();
      })
      .then(payload => {
        const match = payload.data ?? payload;
        if (match && typeof match === "object") {
          const value = match as RestaurantData;
          setRestaurant({ ...value, chef: normalizeChef(value.chef) });
        }
        if (match?.id) {
          if (!String(match.id).startsWith("osm:")) fetch("/ai/describe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              restaurantId: match.id,
              name: match.name,
              city: match.city,
              cuisine: match.types?.[0] || "Restaurant",
              rating: match.rating
            })
          })
            .then(res => res.json())
            .then(data => setAiDescription(data.description));
        }
      })
      .catch(() => setRestaurant(null));

      const reviewsRequest = id.startsWith("osm:")
        ? Promise.resolve({ reviews: [] })
        : fetch(`/api/reviews/google/${encodeURIComponent(id)}`).then((res) => {
            if (!res.ok) throw new Error("Google reviews are unavailable.");
            return res.json();
          });
      reviewsRequest
        .then(data => {
          setReviews(Array.isArray(data.reviews) ? data.reviews : []);
          return fetch(
            `/api/hours/${encodeURIComponent(id)}`
          );
        })
        .then(res => {
          if (!res.ok) {
            throw new Error("Opening hours are unavailable.");
          }
          return res.json();
        })
        .then(data => {
          setHours(Array.isArray(data.hours) ? data.hours : []);
          setOpenNow(typeof data.openNow === "boolean" ? data.openNow : null);
          return fetch(
            `/api/price/${encodeURIComponent(id)}`
          );
        })
        .then(res => {
          if (!res.ok) {
            throw new Error("Price level is unavailable.");
          }
          return res.json();
        })
        .then(data => {
          setPriceLevel(
            typeof data.priceLevel === "string" ? data.priceLevel : null
          );
        })
        .catch(() => {
          setReviews([]);
          setHours([]);
          setOpenNow(null);
          setPriceLevel(null);
        });
  }, [id]);

  useEffect(() => {
    setPrimaryPhoto(null);
    setGallery([]);
    setGalleryOpen(false);
    if (!id) return;
    const controller = new AbortController();
    fetch(`/api/photo/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error("Restaurant photo unavailable.");
        return res.json() as Promise<{ url?: unknown; attribution?: PlacePhoto["attribution"] }>;
      })
      .then(data => {
        if (!controller.signal.aborted && typeof data.url === "string")
          setPrimaryPhoto({ url: data.url, attribution: Array.isArray(data.attribution) ? data.attribution : [] });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    if (!galleryOpen || !id) return;
    const controller = new AbortController();
    setGalleryLoading(true);
    fetch(`/api/photos/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error("Restaurant photos unavailable.");
        return res.json() as Promise<{ photos?: PlacePhoto[] }>;
      })
      .then(data => {
        if (!controller.signal.aborted) setGallery(Array.isArray(data.photos) ? data.photos : []);
      })
      .catch(() => { if (!controller.signal.aborted) setGallery([]); })
      .finally(() => { if (!controller.signal.aborted) setGalleryLoading(false); });
    return () => controller.abort();
  }, [id, galleryOpen]);

  useEffect(() => {
    if (!restaurant) return;

    try {
      const stored = JSON.parse(
        window.localStorage.getItem("recentlyViewed") || "[]"
      ) as unknown;
      const viewed = Array.isArray(stored)
        ? stored.filter((item): item is {
            id: string;
            name: string;
            city: string;
            image: string;
          } => {
            if (!item || typeof item !== "object") return false;
            const value = item as Record<string, unknown>;
            return (
              typeof value.id === "string" &&
              typeof value.name === "string" &&
              typeof value.city === "string" &&
              typeof value.image === "string"
            );
          })
        : [];
      const updated = [
        {
          id: String(restaurant.id),
          name: String(restaurant.name),
          city: String(restaurant.city),
          // Do not persist temporary Google photo URIs in local storage.
          image: ""
        },
        ...viewed.filter((item) => item.id !== restaurant.id)
      ];

      window.localStorage.setItem(
        "recentlyViewed",
        JSON.stringify(updated.slice(0, 10))
      );
    } catch {
      window.localStorage.removeItem("recentlyViewed");
    }
  }, [restaurant]);

  if (!restaurant) {
    return <div className="section">Loading…</div>;
  }

  return (
    <div className="section" style={{ maxWidth: "900px" }}>
      <RestaurantPhoto
        src={primaryPhoto?.url}
        name={restaurant.name}
        style={{
          width: "100%",
          height: "400px",
          borderRadius: "16px",
          marginBottom: "24px"
        }}
      />
      {primaryPhoto && <PhotoAttribution attribution={primaryPhoto.attribution} />}

      {primaryPhoto && !galleryOpen && (
        <button type="button" onClick={() => setGalleryOpen(true)} style={{ marginTop: 12 }}>
          View more photos
        </button>
      )}
      {galleryLoading && <p>Loading photos…</p>}
      {galleryOpen && gallery.length > 0 && (
        <div
          aria-label={`${restaurant.name} photo gallery`}
          style={{
            marginTop: "40px",
            display: "flex",
            gap: "20px",
            overflowX: "auto",
            scrollSnapType: "x mandatory",
            paddingBottom: "8px"
          }}
        >
          {gallery.slice(1).map((photo, i) => (
            <div key={photo.url}>
              <RestaurantPhoto
              src={photo.url}
              name={`${restaurant.name} photo ${i + 1}`}
              style={{
                width: "min(80vw, 640px)",
                height: "300px",
                flex: "0 0 auto",
                borderRadius: "16px",
                scrollSnapAlign: "start"
              }}
              />
              <PhotoAttribution attribution={photo.attribution} />
            </div>
          ))}
        </div>
      )}

      <h1 style={{ fontSize: "2.2rem", marginBottom: "10px" }}>
        {restaurant.name}
      </h1>
      {restaurant.id.startsWith("osm:") && <OsmAttribution />}
      {(restaurant.sourceName === "FSA_UK" || restaurant.sourceName === "ALIM_FR") && (
        <p className="mb-4 text-sm leading-relaxed text-neutral-600" data-testid="government-source-attribution">
          {restaurant.sourceAttribution || "Official public-sector food inspection data"}.
          {" "}Restaurant details are sourced from inspection records and do not confirm current opening status.
        </p>
      )}

      {restaurant.badges && restaurant.badges.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          {restaurant.badges.map((badge: string) => (
            <span
              key={badge}
              style={{
                display: "inline-block",
                padding: "6px 12px",
                background: "#d94800",
                color: "#fff",
                borderRadius: "8px",
                marginRight: "8px",
                marginBottom: "8px",
                fontWeight: 600
              }}
            >
              {badge}
            </span>
          ))}
        </div>
      )}

      {Array.isArray(restaurant.amenities) && restaurant.amenities.length > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <strong>Amenities reported for this venue:</strong>{" "}
          {restaurant.amenities.map((tag) => ({
            delivery: "Delivery",
            takeaway: "Takeaway",
            outdoor_seating: "Outdoor seating",
            wheelchair: "Wheelchair accessibility",
            vegetarian: "Vegetarian food",
          }[tag] ?? tag.replaceAll("_", " "))).join(" · ")}
        </div>
      )}

      <div style={{ fontSize: "1.1rem", opacity: 0.8, marginBottom: "20px" }}>
        {restaurant.address}, {restaurant.city}
      </div>

      {restaurant.claimed === false && (
        <Link
          to={claimToken
            ? `/claim/${encodeURIComponent(restaurant.id)}?token=${encodeURIComponent(claimToken)}`
            : "/owner"}
          data-testid="link-claim-restaurant"
          style={{
            display: "inline-block",
            marginBottom: "24px",
            padding: "12px 20px",
            background: "#2563eb",
            color: "#ffffff",
            borderRadius: "8px",
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          {claimToken ? "Claim this restaurant" : "How to claim this restaurant"}
        </Link>
      )}

      <div style={{ marginBottom: "20px" }}>
        <strong>Rating:</strong> {restaurant.rating == null ? "Not available" : restaurant.rating}
      </div>

      <div style={{ marginBottom: "20px" }}>
        <strong>Price Level:</strong> {formatPrice(priceLevel)}
      </div>

      {hours.length > 0 && (
        <div
          style={{
            marginTop: "40px",
            background: "#fff",
            padding: "24px",
            borderRadius: "16px"
          }}
        >
          <h2 style={{ marginBottom: "12px" }}>Opening Hours</h2>

          {openNow !== null && (
            <div
              style={{
                marginBottom: "16px",
                fontWeight: 600,
                color: openNow ? "green" : "red"
              }}
            >
              {openNow ? "Open Now" : "Closed"}
            </div>
          )}

          {hours.map((line: string, i) => (
            <div key={i} style={{ marginBottom: "8px", opacity: 0.8 }}>
              {line}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: "20px" }}>
        <strong>Website:</strong>{" "}
        {restaurant.website ? <a href={restaurant.website} target="_blank" rel="noreferrer">
          {restaurant.website}
        </a> : "Not available"}
      </div>

      {restaurant.googleMapsUrl && (
        <div style={{ marginBottom: "20px" }}>
          <strong>Google Maps:</strong>{" "}
          <a href={restaurant.googleMapsUrl} target="_blank" rel="noreferrer">
            View on Maps
          </a>
        </div>
      )}

      {restaurant.bookingUrl && (
        <a
          href={restaurant.bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent("booking_now_clicked", { has_provider_label: Boolean(restaurant.bookingProvider?.trim()) }, "/booking")}
          style={{
            display: "inline-block",
            marginTop: "20px",
            padding: "14px 24px",
            background: "#d94800",
            color: "#fff",
            fontWeight: 700,
            borderRadius: "10px",
            textDecoration: "none",
            fontSize: "1.1rem",
            boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
            transition: "transform 0.15s ease, box-shadow 0.15s ease"
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.transform = "translateY(-2px)";
            event.currentTarget.style.boxShadow =
              "0 6px 14px rgba(0,0,0,0.2)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.transform = "translateY(0)";
            event.currentTarget.style.boxShadow =
              "0 4px 10px rgba(0,0,0,0.15)";
          }}
        >
          Book Now
        </a>
      )}

      {restaurant.offers && restaurant.offers.length > 0 && (
        <div
          style={{
            marginTop: "40px",
            background: "#fff",
            padding: "24px",
            borderRadius: "16px"
          }}
        >
          <h2>Deals & Offers</h2>

          {restaurant.offers.map((offer: {
            title: string;
            description: string;
            startDate: string;
            endDate: string;
          }, i: number) => (
            <div
              key={i}
              style={{
                marginBottom: "20px",
                paddingBottom: "16px",
                borderBottom: "1px solid #eee"
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "6px" }}>
                {offer.title}
              </div>

              <div style={{ opacity: 0.8, marginBottom: "8px" }}>
                {offer.description}
              </div>

              <div style={{ fontSize: "0.9rem", opacity: 0.6 }}>
                Valid: {offer.startDate} → {offer.endDate}
              </div>
            </div>
          ))}
        </div>
      )}

      {restaurant.events && restaurant.events.length > 0 && (
        <div
          style={{
            marginTop: "40px",
            background: "#fff",
            padding: "24px",
            borderRadius: "16px"
          }}
        >
          <h2>Events & Live Music</h2>

          {restaurant.events.map((event: {
            id: number;
            title: string;
            description: string;
            date: string;
            time: string;
            price: string;
          }) => (
            <div
              key={event.id}
              style={{
                marginBottom: "20px",
                paddingBottom: "16px",
                borderBottom: "1px solid #eee"
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "6px" }}>
                {event.title}
              </div>

              <div style={{ opacity: 0.8, marginBottom: "8px" }}>
                {event.description}
              </div>

              <div style={{ fontSize: "0.9rem", opacity: 0.7 }}>
                {event.date} at {event.time}
              </div>

              <div style={{ fontSize: "0.9rem", opacity: 0.7 }}>
                {event.price}
              </div>
              <a
                href={`/api/restaurant/${encodeURIComponent(restaurant.id)}/events/${event.id}/calendar`}
                download
                onClick={() => trackEvent("restaurant_event_calendar_clicked", undefined, "/events")}
                style={{ display: "inline-block", marginTop: "12px", color: "#6b4a28", fontWeight: 600 }}
                aria-label={`Add ${event.title} to calendar`}
              >
                Add to calendar
              </a>
            </div>
          ))}
        </div>
      )}

      {restaurant.bestDishes && restaurant.bestDishes.length > 0 && (
        <div
          style={{
            marginTop: "40px",
            background: "#fff",
            padding: "24px",
            borderRadius: "16px"
          }}
        >
          <h2>Best Dishes</h2>

          {restaurant.bestDishes.map((dish: {
            name: string;
            description: string;
            reason: string;
          }) => (
            <div
              key={dish.name}
              style={{
                marginBottom: "20px",
                paddingBottom: "16px",
                borderBottom: "1px solid #eee"
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "6px" }}>
                {dish.name}
              </div>

              <div style={{ opacity: 0.8, marginBottom: "8px" }}>
                {dish.description}
              </div>

              <div style={{ fontSize: "0.9rem", opacity: 0.6 }}>
                {dish.reason}
              </div>
            </div>
          ))}
        </div>
      )}

      {restaurant.chef &&
        (restaurant.chef.name ||
          restaurant.chef.bio ||
          restaurant.chef.signatureDishes?.length > 0 ||
          restaurant.chef.awards?.length > 0 ||
          restaurant.chef.philosophy ||
          restaurant.chef.photo) && (
          <div
            style={{
              marginTop: "40px",
              background: "#fff",
              padding: "24px",
              borderRadius: "16px"
            }}
          >
            <h2>Chef Profile</h2>

            {restaurant.chef.photo && (
              <img
                src={restaurant.chef.photo}
                alt={
                  restaurant.chef.name
                    ? `${restaurant.chef.name}, chef at ${restaurant.name}`
                    : `Chef at ${restaurant.name}`
                }
                style={{
                  width: "160px",
                  height: "160px",
                  objectFit: "cover",
                  borderRadius: "16px",
                  marginTop: "16px"
                }}
              />
            )}

            {restaurant.chef.name && (
              <h3 style={{ marginTop: "16px" }}>{restaurant.chef.name}</h3>
            )}
            {restaurant.chef.verifiedAt && (
              <p style={{ color: "#55704f", fontSize: "0.9rem", fontWeight: 600 }}>
                Verified by The Food Advisor on{" "}
                {new Date(restaurant.chef.verifiedAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            )}
            {restaurant.chef.bio && <p>{restaurant.chef.bio}</p>}

            {restaurant.chef.signatureDishes?.length > 0 && (
              <>
                <h4>Signature Dishes</h4>
                <ul>
                  {restaurant.chef.signatureDishes.map((dish: string) => (
                    <li key={dish}>{dish}</li>
                  ))}
                </ul>
              </>
            )}

            {restaurant.chef.awards?.length > 0 && (
              <>
                <h4>Awards</h4>
                <ul>
                  {restaurant.chef.awards.map((award: string) => (
                    <li key={award}>{award}</li>
                  ))}
                </ul>
              </>
            )}

            {restaurant.chef.philosophy && (
              <>
                <h4>Philosophy</h4>
                <p>{restaurant.chef.philosophy}</p>
              </>
            )}
          </div>
        )}

      <div style={{ marginTop: "40px", opacity: 0.7 }}>
        <em>More features coming soon…</em>
      </div>

      {aiDescription && (
        <div
          style={{
            marginTop: "40px",
            fontSize: "1.1rem",
            lineHeight: "1.6",
            background: "#fff",
            padding: "24px",
            borderRadius: "16px"
          }}
        >
          <h2 style={{ marginBottom: "12px" }}>AI‑Generated Description</h2>
          {aiDescription}
        </div>
      )}

      {reviews.length > 0 && (
        <div
          style={{
            marginTop: "40px",
            background: "#fff",
            padding: "24px",
            borderRadius: "16px"
          }}
        >
          <h2 style={{ marginBottom: "20px" }}>Google Reviews</h2>

          {reviews.map((rev: any, i) => (
            <div
              key={i}
              style={{
                marginBottom: "24px",
                paddingBottom: "16px",
                borderBottom: "1px solid #eee"
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "6px" }}>
                {rev.authorAttribution?.displayName || "Anonymous"}
              </div>

              <div style={{ opacity: 0.7, marginBottom: "8px" }}>
                ⭐ {rev.rating} — {new Date(rev.publishTime).toLocaleDateString()}
              </div>

              <div style={{ lineHeight: "1.6" }}>
                {rev.text?.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {restaurant.claimed === false && claimToken && (
        <div
          style={{
            marginTop: "40px",
            padding: "24px",
            background: "#fff",
            borderRadius: "16px"
          }}
        >
          <h2>Claim this restaurant</h2>
          <p>If you are the owner, you can claim this listing.</p>

          <input
            type="email"
            placeholder="Your business email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              padding: "12px",
              width: "100%",
              marginBottom: "12px",
              borderRadius: "8px",
              border: "1px solid #ccc"
            }}
          />

          <button
            onClick={handleClaim}
            disabled={claimSubmitting}
            style={{
              padding: "12px 20px",
              background: "#d94800",
              color: "#fff",
              borderRadius: "8px",
              border: "none",
              cursor: claimSubmitting ? "wait" : "pointer",
              opacity: claimSubmitting ? 0.7 : 1
            }}
          >
            {claimSubmitting ? "Submitting…" : "Submit Claim"}
          </button>
        </div>
      )}
    </div>
  );
}

function normalizeChef(value: unknown): ChefProfile | null {
  if (!value || typeof value !== "object") return null;
  const chef = value as Record<string, unknown>;
  const items = (candidate: unknown): string[] =>
    Array.isArray(candidate)
      ? candidate
          .map((item) => typeof item === "string" ? item : item && typeof item === "object" && typeof (item as Record<string, unknown>).value === "string" ? (item as Record<string, string>).value : "")
          .filter(Boolean)
          .slice(0, 10)
      : [];
  const stringOrNull = (candidate: unknown) => typeof candidate === "string" && candidate.trim() ? candidate : null;
  return {
    name: stringOrNull(chef.name),
    bio: stringOrNull(chef.bio),
    philosophy: stringOrNull(chef.philosophy),
    photo: stringOrNull(chef.photo),
    signatureDishes: items(chef.signatureDishes),
    awards: items(chef.awards),
    verifiedAt: typeof chef.verifiedAt === "string" ? chef.verifiedAt : null,
    status: typeof chef.status === "string" ? chef.status : undefined,
  };
}

interface RestaurantData {
  id: string;
  name: string;
  city: string;
  address: string;
  website: string | null;
  bookingUrl: string | null;
  bookingProvider: string | null;
  googleMapsUrl: string | null;
  rating: number | null;
  claimed: boolean;
  sourceName?: string;
  sourceAttribution?: string | null;
  badges?: string[];
  amenities?: string[] | null;
  offers?: Array<{ title: string; description: string; startDate: string; endDate: string }>;
  events?: Array<{ id: number; title: string; description: string; date: string; time: string; price: string }>;
  bestDishes?: Array<{ name: string; description: string; reason: string }>;
  chef?: ChefProfile | null;
  [key: string]: unknown;
}
