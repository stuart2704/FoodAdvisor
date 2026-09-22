import { Link, useNavigate } from "react-router-dom";
import { AdminLayout } from "../../components/admin/AdminLayout";
import { RequireAdmin } from "../../components/admin/RequireAdmin";

const adminLinks = [
  {
    to: "/admin/performance",
    title: "Performance Metrics",
    description: "Review throughput, success rates, and engine latency.",
  },
  {
    to: "/admin/errors",
    title: "Error Intelligence",
    description: "Inspect recent error classifications by engine.",
  },
  {
    to: "/admin/outreach",
    title: "Outreach Controls",
    description: "Monitor outreach activity and controls.",
  },
  {
    to: "/admin/restaurants",
    title: "Restaurant Ingestion",
    description: "Review and manage restaurant listings.",
  },
] as const;

export default function AdminDashboard() {
  const navigate = useNavigate();

  async function logout() {
    await fetch("/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    navigate("/admin/login", { replace: true });
  }

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
            <h1 style={{ margin: "6px 0 0" }}>Dashboard</h1>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            style={{
              padding: "9px 14px",
              border: "1px solid #444",
              borderRadius: "8px",
              background: "#222",
              color: "#eee",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </header>

        <nav
          aria-label="Admin dashboard"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "14px",
          }}
        >
          {adminLinks.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              style={{
                padding: "18px",
                border: "1px solid #303030",
                borderRadius: "10px",
                background: "#171717",
                color: "#eee",
                textDecoration: "none",
              }}
            >
              <strong>{item.title}</strong>
              <span
                style={{
                  display: "block",
                  marginTop: "8px",
                  color: "#999",
                  lineHeight: 1.45,
                }}
              >
                {item.description}
              </span>
            </Link>
          ))}
        </nav>
      </AdminLayout>
    </RequireAdmin>
  );
}