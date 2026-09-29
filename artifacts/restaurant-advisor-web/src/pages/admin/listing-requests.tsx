import { useEffect, useState } from "react";
import { AdminLayout } from "../../components/admin/AdminLayout";
import { RequireAdmin } from "../../components/admin/RequireAdmin";
import "../../styles/admin-operations.css";

type ListingRequest = {
  id: number; kind: string; restaurantName: string; city: string; address: string;
  contactName: string; businessEmail: string; website: string | null;
  note: string | null; status: string; createdAt: string;
};

export default function ListingRequestsPage() {
  const [requests, setRequests] = useState<ListingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/dashboard/owner/listing-requests", {
      credentials: "include", cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Listing requests could not be loaded.");
      const data = await response.json() as { requests?: ListingRequest[] };
      if (!Array.isArray(data.requests)) throw new Error("Listing requests returned an unexpected response.");
      setRequests(data.requests);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Listing requests are unavailable.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  return <RequireAdmin><AdminLayout><section className="ops-content">
    <div className="ops-header"><div><h1>Owner listing requests</h1>
      <p className="ops-description">Unsolicited requests are private leads for manual review, not proof of ownership or permission to publish.</p>
    </div></div>
    {loading && <p role="status">Loading requests…</p>}
    {error && <p role="alert" className="ops-state ops-state-error">{error}</p>}
    {!loading && !error && (requests.length === 0 ? <p className="ops-empty">No requests yet.</p> :
      <div className="ops-table-wrap"><table><thead><tr><th>Received</th><th>Request</th><th>Restaurant</th><th>Contact</th><th>Notes</th></tr></thead>
      <tbody>{requests.map((request) => <tr key={request.id}>
        <td>{new Date(request.createdAt).toLocaleString()}</td>
        <td>{request.kind === "new_listing" ? "New listing" : "No invitation"}</td>
        <td><strong>{request.restaurantName}</strong><br />{request.address}, {request.city}{request.website && <><br /><a href={request.website} target="_blank" rel="noopener noreferrer">Website</a></>}</td>
        <td>{request.contactName}<br /><a href={`mailto:${request.businessEmail}`}>{request.businessEmail}</a></td>
        <td>{request.note || "—"}</td>
      </tr>)}</tbody></table></div>)}
  </section></AdminLayout></RequireAdmin>;
}