import { AdminLayout } from "../../components/admin/AdminLayout";
import IngestionDashboard from "../../components/admin/IngestionDashboard";
import { RequireAdmin } from "../../components/admin/RequireAdmin";

export default function AdminIngestion() {
  return (
    <RequireAdmin>
      <AdminLayout>
        <IngestionDashboard />
      </AdminLayout>
    </RequireAdmin>
  );
}