import { useState } from "react";
import { AdminLayout } from "../../components/admin/AdminLayout";
import IngestionDashboard from "../../components/admin/IngestionDashboard";
import { RequireAdmin } from "../../components/admin/RequireAdmin";
import OrchestrationPanel from "../../admin/OrchestrationPanel";
import ManualIngestionControls from "../../admin/ManualIngestionControls";

export default function AdminIngestion() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <RequireAdmin>
      <AdminLayout>
        <IngestionDashboard refreshKey={refreshKey} />
        <OrchestrationPanel />
        <ManualIngestionControls onSuccess={() => setRefreshKey((value) => value + 1)} />
      </AdminLayout>
    </RequireAdmin>
  );
}