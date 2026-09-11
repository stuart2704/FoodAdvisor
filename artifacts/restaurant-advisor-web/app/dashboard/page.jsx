"use client";

// Inactive draft in this Vite app; does not replace the existing dashboard.
// AnalyticsCard, StatusTimeline, and the analytics endpoint are not implemented.
import { useEffect, useState } from "react";
import AnalyticsCard from "@/components/AnalyticsCard";
import StatusTimeline from "@/components/StatusTimeline";

export default function DashboardPage() {
  const [analytics, setAnalytics] = useState(null);

  useEffect(() => {
    const loadAnalytics = async () => {
      const res = await fetch("/api/analytics");
      const data = await res.json();
      setAnalytics(data);
    };

    loadAnalytics();
  }, []);

  if (!analytics) return <p>Loading…</p>;

  return (
    <div className="upgrade-container">
      <h1>Restaurant Analytics</h1>
      <p>Your performance inside The Food Advisor app.</p>

      <div className="analytics-grid">
        <AnalyticsCard title="Profile Views" value={analytics.views} />
        <AnalyticsCard title="Menu Opens" value={analytics.menuOpens} />
        <AnalyticsCard title="Search Appearances" value={analytics.searchAppearances} />
        <AnalyticsCard title="Clicks to Website" value={analytics.websiteClicks} />
        <AnalyticsCard title="Upgrade Funnel Position" value={analytics.funnel} />
      </div>

      <StatusTimeline timeline={analytics.timeline} />
    </div>
  );
}