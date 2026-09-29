import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AdminLayout } from "../../components/admin/AdminLayout";
import { RequireAdmin } from "../../components/admin/RequireAdmin";
import { SocialDashboard } from "../../components/admin/social/SocialDashboard";
import { ConnectedAccounts } from "../../components/admin/social/ConnectedAccounts";
import { RestaurantAutomation } from "../../components/admin/social/RestaurantAutomation";
import { BrandAutomation } from "../../components/admin/social/BrandAutomation";
import { Schedules } from "../../components/admin/social/Schedules";
import { PostQueue } from "../../components/admin/social/PostQueue";
import { PublishingLogs } from "../../components/admin/social/PublishingLogs";
import { ErrorIntel } from "../../components/admin/social/ErrorIntel";
import "../../styles/admin-social.css";

type Tab = "dashboard" | "accounts" | "restaurant" | "brand" | "schedules" | "queue" | "logs" | "errors";
const tabs: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" }, { id: "accounts", label: "Accounts" },
  { id: "restaurant", label: "Restaurant" }, { id: "brand", label: "Brand" },
  { id: "schedules", label: "Schedules" }, { id: "queue", label: "Queue" },
  { id: "logs", label: "Logs" }, { id: "errors", label: "Error Intelligence" },
];
const basePath = "/admin/automation/social";

export default function SocialAutomationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const activeTab: Tab = location.pathname === `${basePath}/logs` ? "logs"
    : location.pathname === `${basePath}/error-intelligence` ? "errors"
    : tabs.some(tab => tab.id === requestedTab) ? requestedTab as Tab : "dashboard";
  const [queueRefreshKey, setQueueRefreshKey] = useState(0);

  const selectTab = (tab: Tab) => {
    navigate(tab === "logs" ? `${basePath}/logs`
      : tab === "errors" ? `${basePath}/error-intelligence`
      : tab === "dashboard" ? basePath : `${basePath}?tab=${tab}`);
  };

  const handleQueueRefresh = () => {
    setQueueRefreshKey(prev => prev + 1);
  };

  const renderTab = () => {
    switch (activeTab) {
      case "dashboard": return <SocialDashboard onNavigate={selectTab} />;
      case "accounts": return <ConnectedAccounts />;
      case "restaurant": return <RestaurantAutomation onQueueRefresh={handleQueueRefresh} />;
      case "brand": return <BrandAutomation onQueueRefresh={handleQueueRefresh} />;
      case "schedules": return <Schedules />;
      case "queue": return <PostQueue key={queueRefreshKey} />;
      case "logs": return <PublishingLogs />;
      case "errors": return <ErrorIntel />;
      default: return null;
    }
  };

  return (
    <RequireAdmin>
      <AdminLayout>
        <div className="social-header">
          <div style={{ color: "#aaa", marginBottom: 8 }}>
            Automation › Social Media{activeTab === "logs" ? " › Logs" : activeTab === "errors" ? " › Error Intelligence" : ""}
          </div>
          <h1>Social Media</h1>
          {activeTab !== "queue" && (
            <button type="button" className="social-btn" style={{ marginBottom: 16 }}
              onClick={() => selectTab("queue")}>Write a Facebook post</button>
          )}
          <nav className="social-tabs" aria-label="Social Media sections">
            {tabs.map(tab => (
              <button 
                key={tab.id}
                type="button"
                className={`social-tab ${activeTab === tab.id ? "active" : ""}`}
                aria-current={activeTab === tab.id ? "page" : undefined}
                onClick={() => selectTab(tab.id)}
              >
                {tab.label}
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
