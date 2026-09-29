import { useEffect, useState } from "react";

type Alert = {
  restaurantId: string;
  restaurantName: string | null;
  sessionId: string;
  customerId: string;
  subscriptionId: string | null;
  paidObservedAt: string;
  alertedAt: string;
};

export function PaidCheckoutAlerts() {
  const [items, setItems] = useState<Alert[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    async function refresh() {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch("/dashboard/premium/checkout-alerts", {
          credentials: "include", cache: "no-store", signal: request.signal,
        });
        if (!response.ok) throw new Error("Could not check paid checkout alerts.");
        const result: unknown = await response.json();
        if (!result || typeof result !== "object" || !("items" in result) ||
          !Array.isArray(result.items) || !result.items.every((item: unknown) =>
            item !== null && typeof item === "object" &&
            "sessionId" in item && typeof item.sessionId === "string" &&
            "restaurantId" in item && typeof item.restaurantId === "string" &&
            "paidObservedAt" in item && typeof item.paidObservedAt === "string")) {
          throw new Error("Invalid alert response.");
        }
        if (active && !request.signal.aborted) { setItems(result.items as Alert[]); setError(false); }
      } catch {
        if (active && !request.signal.aborted) {
          setError(true);
          setItems(null);
        }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); };
  }, []);

  return <section className="ad-section" aria-labelledby="checkout-alert-title">
    <div className="ad-section-head">
      <h2 id="checkout-alert-title">Premium checkout alerts</h2>
      <p>Paid in Stripe but not activated after 15 minutes · checked every 5 minutes</p>
    </div>
    {error ? <div className="ad-alert" role="alert">Checkout alerts are unavailable. Check the API logs; do not assume there are no incidents.</div>
      : items === null ? <p role="status">Checking paid checkouts…</p>
      : items.length === 0 ? <p>No paid checkout alerts recorded. Stripe checks can be delayed during a provider outage; check the API logs if payments appear stuck.</p>
      : <div className="ad-alert" role="alert">
        <strong>{items.length} paid checkout{items.length === 1 ? "" : "s"} need investigation</strong>
        <ul>{items.map(item => <li key={item.sessionId}>
          <strong>{item.restaurantName || item.restaurantId}</strong> ({item.restaurantId}) ·
          session {item.sessionId} · customer {item.customerId} · subscription {item.subscriptionId || "missing"}
          {" · "}First seen {new Date(item.paidObservedAt).toLocaleString()}
        </li>)}</ul>
        <p>Check Stripe and the claimed restaurant mapping. Only verified reconciliation grants Premium access.</p>
      </div>}
  </section>;
}