import { AdminLayout } from "../../components/admin/AdminLayout";
import PerformancePanel from "../../components/admin/PerformancePanel";
import { RequireAdmin } from "../../components/admin/RequireAdmin";

export default function AdminPerformance() {
  return (
    <RequireAdmin>
      <AdminLayout>
        <header style={{ marginBottom: "24px" }}>
          <p style={{ color: "#ff8b47", fontWeight: 700, margin: 0 }}>
            The Food Advisor Admin
          </p>
          <h1 style={{ margin: "6px 0 0" }}>Performance Metrics</h1>
        </header>
        <PerformancePanel />
      </AdminLayout>
    </RequireAdmin>
  );
}