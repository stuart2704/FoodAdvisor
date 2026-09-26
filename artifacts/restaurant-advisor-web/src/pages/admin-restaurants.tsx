import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "../components/admin/AdminLayout";
import { RequireAdmin } from "../components/admin/RequireAdmin";
import { BookingLinkManager, type Booking } from "../components/admin/BookingLinkManager";

interface AdminRestaurant {
  placeId: string;
  name: string;
  city: string;
  region: string | null;
  bookingUrl: string | null;
  bookingProvider: string | null;
  bookingStatus: string | null;
}

export default function ManageRestaurantsPage() {
  const [restaurants, setRestaurants] = useState<AdminRestaurant[] | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setRestaurants(null);
    setError("");
    void fetch(`/dashboard/restaurants?page=${page}&limit=100`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success?: boolean;
          restaurants?: AdminRestaurant[];
          total?: number;
          error?: string;
        };
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? "Restaurants could not be loaded.");
        }
        setRestaurants(payload.restaurants ?? []);
        setTotal(payload.total ?? 0);
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
  }, [page]);

  function updateBooking(placeId: string, booking: Booking) {
    setRestaurants((current) => current?.map((restaurant) => restaurant.placeId === placeId
      ? { ...restaurant, bookingUrl: booking.url, bookingProvider: booking.provider, bookingStatus: booking.status }
      : restaurant) ?? null);
  }

  return (
    <RequireAdmin>
      <AdminLayout>
        <header style={{ marginBottom: "24px" }}>
          <p style={{ color: "#ff8b47", fontWeight: 700, margin: 0 }}>
            The Food Advisor Admin
          </p>
          <h1 style={{ margin: "6px 0 0" }}>Restaurants</h1>
        </header>

        {error ? (
          <p style={{ color: "#ff9b8d" }} role="alert">
            {error}
          </p>
        ) : null}
        {!restaurants && !error ? <p>Loading restaurants…</p> : null}
        {restaurants?.length === 0 ? <p>No restaurants on this page.</p> : null}
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
              <Link
                to={`/admin/owner-contacts?placeId=${encodeURIComponent(restaurant.placeId)}`}
                style={{ color: "#ff8b47", marginLeft: "16px" }}
                data-testid={`link-private-contact-${restaurant.placeId}`}
              >
                Request private contact
              </Link>
              <BookingLinkManager
                restaurantId={restaurant.placeId}
                restaurantName={restaurant.name}
                booking={{ url: restaurant.bookingUrl, provider: restaurant.bookingProvider, status: restaurant.bookingStatus }}
                onChange={(booking) => updateBooking(restaurant.placeId, booking)}
              />
            </li>
          ))}
        </ul>
        {restaurants && (
          <nav aria-label="Restaurant pages" style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
            <button type="button" onClick={() => setPage((current) => current - 1)} disabled={page === 1}>Previous</button>
            <span>Page {page} of {Math.max(1, Math.ceil(total / 100))} ({total} restaurants)</span>
            <button type="button" onClick={() => setPage((current) => current + 1)} disabled={page * 100 >= total}>Next</button>
          </nav>
        )}
      </AdminLayout>
    </RequireAdmin>
  );
}