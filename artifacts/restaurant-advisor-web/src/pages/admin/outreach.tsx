import { useEffect, useState } from "react";
import { AdminLayout } from "../../components/admin/AdminLayout";
import { RequireAdmin } from "../../components/admin/RequireAdmin";

interface OutreachItem {
  id: number;
  restaurant: string;
  recipientDomain: string | null;
  sentAt: string;
}

interface OutreachRecords {
  success: boolean;
  items: OutreachItem[];
  error?: string;
}

interface OutreachSummary {
  success: boolean;
  totalEvents: number;
  sent: number;
  failed: number;
  error?: string;
}

export default function AdminOutreach() {
  const [records, setRecords] = useState<OutreachItem[]>([]);
  const [summary, setSummary] = useState<OutreachSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const options: RequestInit = {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    };
    setError(null);
    void Promise.all([
      fetch("/dashboard/outreach?page=1&limit=50", options),
      fetch("/dashboard/outreach/summary", options),
    ])
      .then(async ([recordsResponse, summaryResponse]) => {
        const recordsData = (await recordsResponse.json()) as OutreachRecords;
        const summaryData = (await summaryResponse.json()) as OutreachSummary;
        if (
          !recordsResponse.ok ||
          !summaryResponse.ok ||
          !recordsData.success ||
          !summaryData.success
        ) {
          throw new Error(
            recordsData.error ??
              summaryData.error ??
              "Outreach activity is unavailable.",
          );
        }
        setRecords(recordsData.items);
        setSummary(summaryData);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError")) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Outreach activity is unavailable.",
          );
        }
      });
    return () => controller.abort();
  }, [revision]);

  return (
    <RequireAdmin>
      <AdminLayout>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <div>
            <p style={{ color: "#ff8b47", fontWeight: 700, margin: 0 }}>
              The Food Advisor Admin
            </p>
            <h1 style={{ margin: "6px 0 0" }}>Outreach Controls</h1>
          </div>
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
            style={{
              padding: "9px 14px",
              border: "1px solid #444",
              borderRadius: "8px",
              background: "#222",
              color: "#eee",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "12px",
            marginBottom: "20px",
          }}
          aria-label="Outreach summary"
        >
          {[
            ["Confirmed sends", summary?.sent],
            ["Failed sends", summary?.failed],
            ["All audit events", summary?.totalEvents],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                padding: "16px",
                border: "1px solid #303030",
                borderRadius: "10px",
                background: "#171717",
              }}
            >
              <span style={{ color: "#999", fontSize: "0.8rem" }}>
                {label}
              </span>
              <strong
                style={{
                  display: "block",
                  marginTop: "8px",
                  fontSize: "1.5rem",
                }}
              >
                {typeof value === "number" ? value.toLocaleString() : "—"}
              </strong>
            </div>
          ))}
        </section>

        {error ? (
          <p role="alert" style={{ color: "#ff9b8d" }}>
            {error}
          </p>
        ) : (
          <section
            style={{
              overflowX: "auto",
              border: "1px solid #303030",
              borderRadius: "10px",
              background: "#171717",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
              }}
            >
              <thead>
                <tr>
                  {["Restaurant", "Recipient domain", "Sent"].map((heading) => (
                    <th
                      key={heading}
                      style={{ padding: "12px", borderBottom: "1px solid #333" }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td style={{ padding: "12px" }}>{record.restaurant}</td>
                    <td style={{ padding: "12px", color: "#aaa" }}>
                      {record.recipientDomain ?? "—"}
                    </td>
                    <td style={{ padding: "12px", color: "#aaa" }}>
                      {new Date(record.sentAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length === 0 ? (
              <p style={{ padding: "16px", color: "#999" }}>
                No confirmed outreach sends found.
              </p>
            ) : null}
          </section>
        )}
      </AdminLayout>
    </RequireAdmin>
  );
}