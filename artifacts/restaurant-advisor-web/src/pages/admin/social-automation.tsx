import { useState } from "react";
import { AdminLayout } from "../../components/admin/AdminLayout";
import { RequireAdmin } from "../../components/admin/RequireAdmin";
import { SocialDashboard } from "../../components/admin/social/SocialDashboard";
import { ConnectedAccounts } from "../../components/admin/social/ConnectedAccounts";
import { RestaurantAutomation } from "../../components/admin/social/RestaurantAutomation";
import { BrandAutomation } from "../../components/admin/social/BrandAutomation";
import { Schedules } from "../../components/admin/social/Schedules";
import { PostQueue } from "../../components/admin/social/PostQueue";
import { PublishingLogs } from "../../components/admin/social/PublishingLogs";
import "../../styles/admin-social.css";

type Tab = "dashboard" | "accounts" | "restaurant" | "brand" | "schedules" | "queue" | "logs";

export default function SocialAutomationPage() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [queueRefreshKey, setQueueRefreshKey] = useState(0);

  const handleQueueRefresh = () => {
    setQueueRefreshKey(prev => prev + 1);
  };

  const renderTab = () => {
    switch (activeTab) {
      case "dashboard": return <SocialDashboard onNavigate={setActiveTab} />;
      case "accounts": return <ConnectedAccounts />;
      case "restaurant": return <RestaurantAutomation onQueueRefresh={handleQueueRefresh} />;
      case "brand": return <BrandAutomation onQueueRefresh={handleQueueRefresh} />;
      case "schedules": return <Schedules />;
      case "queue": return <PostQueue key={queueRefreshKey} />;
      case "logs": return <PublishingLogs />;
      default: return null;
    }
  };

  return (
    <RequireAdmin>
      <AdminLayout>
        <div className="social-header">
          <h1>Social Automation</h1>
          <nav className="social-tabs">
            {["dashboard", "accounts", "restaurant", "brand", "schedules", "queue", "logs"].map(tab => (
              <button 
                key={tab} 
                className={`social-tab ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab as Tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>
        <div className="social-content">
          {renderTab()}
        </div>
      </AdminLayout>
    </RequireAdmin>
  );
}
