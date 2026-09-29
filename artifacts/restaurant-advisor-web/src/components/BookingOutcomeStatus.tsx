/**
 * A booking link is not a provider integration. Until a provider authorizes an
 * attributed confirmation feed, the outcome is unknown, not zero.
 */
export function BookingOutcomeStatus({ provider }: { provider: string | null }) {
  return (
    <div aria-label="Booking outcome reporting">
      <strong>Booking outcomes · {provider?.trim() || "Provider not specified"}</strong>
      <p>Book Now clicks: outbound intent only (tracked in website analytics when enabled).</p>
      <p>Confirmed reservations: unavailable — no confirmation feed connected for this provider.</p>
      <p>Click-to-confirmed-booking conversion: unavailable, not 0%. We cannot tell whether a diner completed a booking after leaving this site.</p>
    </div>
  );
}