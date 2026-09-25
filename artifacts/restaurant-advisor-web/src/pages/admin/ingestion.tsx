import { AdminLayout } from "../../components/admin/AdminLayout";
import IngestionDashboard from "../../components/admin/IngestionDashboard";
import { RequireAdmin } from "../../components/admin/RequireAdmin";
import OrchestrationPanel from "../../admin/OrchestrationPanel";

export default function AdminIngestion() {
  return (
    <RequireAdmin>
      <AdminLayout>
        <IngestionDashboard />
        <OrchestrationPanel />
      </AdminLayout>
    </RequireAdmin>
  );
}