import { useEffect, useState, type FormEvent } from "react";
import { trackEvent } from "../../lib/analytics";
import { BookingOutcomeStatus } from "../BookingOutcomeStatus";

export interface Booking {
  url: string | null;
  provider: string | null;
  status: string | null;
}

interface Props {
  restaurantId: string;
  restaurantName: string;
  booking: Booking;
  onChange: (booking: Booking) => void;
}

export function BookingLinkManager({ restaurantId, restaurantName, booking, onChange }: Props) {
  const [url, setUrl] = useState(booking.url ?? "");
  const [provider, setProvider] = useState(booking.provider ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setUrl(booking.url ?? "");
    setProvider(booking.provider ?? "");
  }, [booking.url, booking.provider]);

  async function publish(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    const trimmed = url.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:" || !parsed.hostname || trimmed.length > 2048) {
        throw new Error("Enter an HTTPS booking URL (up to 2,048 characters).");
      }
    } catch {
      setError("Enter a valid HTTPS booking URL (up to 2,048 characters).");
      return;
    }
    if (provider.trim().length > 80) {
      setError("Provider name must be 80 characters or fewer.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/admin/restaurants/${encodeURIComponent(restaurantId)}/booking`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, provider: provider.trim() || null }),
      });
      const payload = await response.json() as { success?: boolean; booking?: Booking; error?: string };
      if (!response.ok || !payload.success || !payload.booking) {
        throw new Error(payload.error || "Booking link could not be published.");
      }
      onChange(payload.booking);
      setMessage("Booking link checked and published.");
      trackEvent("booking_link_published", { has_provider_label: Boolean(payload.booking.provider?.trim()) }, "/booking");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Booking link could not be published.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!window.confirm(`Withdraw the booking link for ${restaurantName}? Diners will no longer see it.`)) return;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/restaurants/${encodeURIComponent(restaurantId)}/booking`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Booking link could not be withdrawn.");
      }
      onChange({ url: null, provider: null, status: null });
      setMessage("Booking link withdrawn.");
      trackEvent("booking_link_withdrawn", undefined, "/booking");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Booking link could not be withdrawn.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={`Booking link for ${restaurantName}`} style={{ marginTop: 16, borderTop: "1px solid #303030", paddingTop: 14 }}>
      <strong>Booking link</strong>
      <p style={{ margin: "6px 0", color: "#bbb", overflowWrap: "anywhere" }}>
        Provider: {booking.provider || "Not set"} · Approval: {booking.status || "Not set"}<br />
        URL: {booking.url || "No booking link"}
      </p>
      {booking.url && <BookingOutcomeStatus provider={booking.provider} />}
      <form onSubmit={(event) => void publish(event)} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
        <label style={{ display: "grid", gap: 4, flex: "2 1 280px" }}>
          Booking URL
          <input type="url" required maxLength={2048} placeholder="https://…" value={url} onChange={(event) => { setUrl(event.target.value); setError(""); setMessage(""); }} disabled={busy} style={{ width: "100%", boxSizing: "border-box", padding: 9 }} />
        </label>
        <label style={{ display: "grid", gap: 4, flex: "1 1 160px" }}>
          Provider (optional)
          <input type="text" maxLength={80} value={provider} onChange={(event) => { setProvider(event.target.value); setError(""); setMessage(""); }} disabled={busy} style={{ width: "100%", boxSizing: "border-box", padding: 9 }} />
        </label>
        <button type="submit" disabled={busy} style={{ padding: "10px 12px", cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Checking…" : "Check and publish"}
        </button>
        {booking.url && <button type="button" disabled={busy} onClick={() => void withdraw()} style={{ padding: "10px 12px", cursor: busy ? "wait" : "pointer" }}>Withdraw link</button>}
      </form>
      {error && <p role="alert" style={{ color: "#ff9b8d" }}>{error}</p>}
      {message && <p role="status" style={{ color: "#8de1ab" }}>{message}</p>}
    </section>
  );
}