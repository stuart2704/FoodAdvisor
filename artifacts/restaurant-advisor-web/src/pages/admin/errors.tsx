import { AdminLayout } from "../../components/admin/AdminLayout";
import ErrorPanel from "../../components/admin/ErrorPanel";
import { RequireAdmin } from "../../components/admin/RequireAdmin";

export default function AdminErrors() {
  return (
    <RequireAdmin>
      <AdminLayout>
        <header style={{ marginBottom: "24px" }}>
          <p style={{ color: "#ff8b47", fontWeight: 700, margin: 0 }}>
            The Food Advisor Admin
          </p>
          <h1 style={{ margin: "6px 0 0" }}>Error Intelligence</h1>
        </header>
        <ErrorPanel />
      </AdminLayout>
    </RequireAdmin>
  );
}