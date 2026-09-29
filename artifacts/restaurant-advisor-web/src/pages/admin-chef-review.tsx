import { useCallback, useEffect, useRef, useState } from "react";
import { AdminLayout } from "../components/admin/AdminLayout";
import { RequireAdmin } from "../components/admin/RequireAdmin";

interface ChefSubmission {
  restaurantId: string;
  restaurantName?: string;
  name?: string | null;
  bio?: string | null;
  philosophy?: string | null;
  photoObjectPath?: string | null;
  awards?: string[];
  awardEvidenceUrls?: string[];
  signatureDishes?: string[];
  dishEvidenceUrls?: string[];
  moderationStatus?: string;
  updatedAt: string;
}

export default function AdminChefReviewPage() {
  const [submissions, setSubmissions] = useState<ChefSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string[]>([]);
  const busyIds = useRef(new Set<string>());
  const requestId = useRef(0);
  const load = useCallback(async () => {
    if (busyIds.current.size) return;
    const id = ++requestId.current;
    try {
      const response = await fetch("/api/admin/chef-profiles/pending", { credentials: "include", cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || payload.success === false) throw new Error(payload.error || "Chef submissions could not be loaded.");
      if (id === requestId.current) {
        setSubmissions(Array.isArray(payload.profiles) ? payload.profiles : []);
        setError("");
      }
    } catch (failure) {
      if (id === requestId.current) setError(failure instanceof Error ? failure.message : "Chef submissions could not be loaded.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      requestId.current++;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [load]);

  async function moderate(submission: ChefSubmission, action: "approve" | "reject" | "remove") {
    if (busyIds.current.has(submission.restaurantId)) return;
    if (action === "remove") {
      if (!window.confirm("Remove this chef profile?")) return;
    }
    busyIds.current.add(submission.restaurantId);
    setBusy((current) => [...current, submission.restaurantId]);
    requestId.current++; // An older queue response must not restore a decided card.
    setError("");
    setNotice("");
    try {
      const path = action === "remove" ? `/api/admin/chef-profiles/${encodeURIComponent(submission.restaurantId)}` : `/api/admin/chef-profiles/${encodeURIComponent(submission.restaurantId)}/${action}`;
      const response = await fetch(path, {
        method: action === "remove" ? "DELETE" : "POST",
        credentials: "include",
         headers: { "Content-Type": "application/json", "X-Chef-Review-Revision": submission.updatedAt },
        body: action === "reject" ? JSON.stringify({ reason: "Evidence requires additional verification." }) : undefined,
      });
      const payload = await response.json();
      if (response.status === 409 && payload.code === "CHEF_REVIEW_STALE") {
        setSubmissions((current) => current.filter((item) => item.restaurantId !== submission.restaurantId));
        setNotice("This chef profile changed since you opened it. The pending queue has been refreshed.");
        return;
      }
      if (!response.ok || payload.success === false) throw new Error(payload.error || `Could not ${action} chef profile.`);
      setSubmissions((current) => current.filter((item) => item.restaurantId !== submission.restaurantId));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `Could not ${action} chef profile.`);
    } finally {
      busyIds.current.delete(submission.restaurantId);
      setBusy((current) => current.filter((id) => id !== submission.restaurantId));
      void load();
    }
  }

  return (
    <RequireAdmin>
      <AdminLayout>
        <header style={{ marginBottom: 24 }}>
          <p style={{ color: "#ff8b47", fontWeight: 700, margin: 0 }}>The Food Advisor Admin</p>
          <h1 style={{ margin: "6px 0 0" }}>Chef profile review</h1>
          <p style={{ color: "#aaa" }}>Verify evidence before chef details appear on public restaurant profiles.</p>
        </header>
        {error && <p role="alert" style={{ color: "#ff9b8d" }}>{error}</p>}
        {notice && <p role="status" style={{ color: "#ffb977" }}>{notice}</p>}
        {loading && <p>Loading submissions…</p>}
        {!loading && submissions.length === 0 && <p style={{ color: "#aaa" }}>No pending chef profiles.</p>}
        <div style={{ display: "grid", gap: 16 }}>
          {submissions.map((submission) => (
            <article key={submission.restaurantId} style={{ padding: 20, border: "1px solid #303030", borderRadius: 12, background: "#171717" }}>
              <h2 style={{ margin: 0 }}>{submission.name || "Unnamed chef"}</h2>
              <p style={{ color: "#aaa", marginTop: 6 }}>{submission.restaurantName || submission.restaurantId}</p>
              {submission.photoObjectPath && <img src={`/api/admin/chef-profiles/${encodeURIComponent(submission.restaurantId)}/photo`} alt="" style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 10 }} />}
              {submission.bio && <p>{submission.bio}</p>}
              {submission.philosophy && <p><strong>Philosophy:</strong> {submission.philosophy}</p>}
              {(["signatureDishes", "awards"] as const).map((key) => submission[key]?.length ? (
                <div key={key} style={{ marginTop: 12 }}>
                  <strong>{key === "awards" ? "Awards" : "Signature dishes"}</strong>
                  <ul>{submission[key]?.map((item, index) => {
                    const evidence = key === "awards" ? submission.awardEvidenceUrls?.[index] : submission.dishEvidenceUrls?.[index];
                    return <li key={`${key}-${index}`}>{item} {evidence && <a href={evidence} target="_blank" rel="noreferrer" style={{ color: "#ff8b47" }}>Evidence</a>}</li>;
                  })}</ul>
                </div>
              ) : null)}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
                <button type="button" disabled={busy.includes(submission.restaurantId)} onClick={() => void moderate(submission, "approve")} style={{ background: "#18864b", color: "white", border: 0, borderRadius: 8, padding: "10px 16px", fontWeight: 700 }}>Approve</button>
                <button type="button" disabled={busy.includes(submission.restaurantId)} onClick={() => void moderate(submission, "reject")} style={{ background: "#7d321f", color: "white", border: 0, borderRadius: 8, padding: "10px 16px", fontWeight: 700 }}>Reject</button>
                <button type="button" disabled={busy.includes(submission.restaurantId)} onClick={() => void moderate(submission, "remove")} style={{ background: "transparent", color: "#ff9b8d", border: "1px solid #7d321f", borderRadius: 8, padding: "10px 16px" }}>Remove</button>
              </div>
            </article>
          ))}
        </div>
      </AdminLayout>
    </RequireAdmin>
  );
}