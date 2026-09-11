"use client";

import { useEffect, useState } from "react";

export default function PlatformConnections() {
  const [connections, setConnections] = useState(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/social/connections");
      const data = await res.json();
      setConnections(data);
    };

    load();
  }, []);

  const connect = async (platform) => {
    const res = await fetch(`/api/social/connect/${platform}`, {
      method: "POST"
    });

    const data = await res.json();
    setStatus(data.message);
  };

  if (!connections) return <p>Loading…</p>;

  return (
    <div>
      <h1>Connect Your Social Media Accounts</h1>
      <p>Allow The Food Advisor AI to post automatically for you.</p>

      <div className="platform-list">
        {["instagram", "facebook", "tiktok", "x", "google"].map((platform) => (
          <div key={platform} className="platform-item">
            <h3>{platform.toUpperCase()}</h3>
            <p>
              Status:{" "}
              {connections[platform] ? "Connected" : "Not Connected"}
            </p>

            {!connections[platform] && (
              <button
                className="upgrade-button"
                onClick={() => connect(platform)}
              >
                Connect {platform}
              </button>
            )}
          </div>
        ))}
      </div>

      {status && <p>{status}</p>}
    </div>
  );
}