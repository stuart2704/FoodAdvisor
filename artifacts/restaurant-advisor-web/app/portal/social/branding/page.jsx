"use client";

import { useState, useEffect } from "react";

export default function BrandingSettings() {
  const [branding, setBranding] = useState(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/social/branding");
      const data = await res.json();
      setBranding(data);
    };

    load();
  }, []);

  const save = async () => {
    const res = await fetch("/api/social/branding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(branding)
    });

    const data = await res.json();
    setStatus(data.message);
  };

  if (!branding) return <p>Loading…</p>;

  return (
    <div>
      <h1>Branding Settings</h1>

      <label>Tone</label>
      <select
        value={branding.tone}
        onChange={(e) => setBranding({ ...branding, tone: e.target.value })}
      >
        <option value="friendly">Friendly</option>
        <option value="luxury">Luxury</option>
        <option value="casual">Casual</option>
        <option value="bold">Bold</option>
      </select>

      <label>Emoji Usage</label>
      <input
        type="checkbox"
        checked={branding.emojis}
        onChange={(e) => setBranding({ ...branding, emojis: e.target.checked })}
      />

      <label>Hashtag Style</label>
      <select
        value={branding.hashtagStyle}
        onChange={(e) => setBranding({ ...branding, hashtagStyle: e.target.value })}
      >
        <option value="minimal">Minimal</option>
        <option value="full">Full</option>
        <option value="trending">Trending</option>
      </select>

      <button className="upgrade-button" onClick={save}>
        Save Branding
      </button>

      {status && <p>{status}</p>}
    </div>
  );
}