import { useState } from "react";
import { fetchSocial } from "./api";

export function RestaurantAutomation({ onQueueRefresh }: { onQueueRefresh?: () => void }) {
  const [restaurantId, setRestaurantId] = useState("");
  const [platform, setPlatform] = useState("facebook");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setError("");
    setResult(null);
    try {
      const data = await fetchSocial<{ post: any }>("/posts/generate", {
        method: "POST",
        body: JSON.stringify({ restaurantId, platform })
      });
      setResult(data.post);
      if (onQueueRefresh) onQueueRefresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="social-card">
        <h2>Restaurant Content Generator</h2>
        <p style={{ color: "#aaa", fontSize: "0.9rem", lineHeight: 1.6 }}>
          Use this tool to manually trigger the content generation engine for a specific restaurant. 
          This evaluates their latest menu updates, reviews, and highlights to draft an engaging post. 
          Generated posts are added to the Post Queue in a Draft state, waiting for explicit approval.
        </p>

        {error && <div className="social-alert" style={{ marginTop: "16px" }}>{error}</div>}

        <form onSubmit={handleGenerate} style={{ marginTop: "24px" }}>
          <div className="social-form-group">
            <label>Place ID / Restaurant ID</label>
            <input 
              type="text" 
              required 
              value={restaurantId}
              onChange={(e) => setRestaurantId(e.target.value)}
              placeholder="Restaurant identifier"
            />
          </div>
          <div className="social-form-group">
            <label>Platform</label>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="facebook">Facebook</option>
            </select>
          </div>
          <button type="submit" className="social-btn" disabled={generating}>
            {generating ? "Generating Draft..." : "Generate Post Draft"}
          </button>
        </form>
      </div>

      {result && (
        <div className="social-card">
          <h2>Generation Result</h2>
          <div className="social-success">Successfully drafted post {result.id}</div>
          <div style={{ padding: "16px", background: "#0d0d0d", borderRadius: "8px", border: "1px solid #333", whiteSpace: "pre-wrap" }}>
            {result.content}
          </div>
          <p style={{ marginTop: "12px", fontSize: "0.85rem", color: "#aaa" }}>
            This draft has been placed in the Queue. Review and publish it from the Post Queue tab.
          </p>
        </div>
      )}

      <div className="social-card">
        <h2>Restaurant-Level Automation Policies</h2>
        <p style={{ color: "#aaa", fontSize: "0.9rem", lineHeight: 1.6 }}>
          The system automatically coordinates publishing schedules and connects to individual owner accounts based on the credentials provisioned in <strong>Connected Accounts</strong>. 
          <br/><br/>
          This module manages isolation:
        </p>
        <ul style={{ color: "#bbb", fontSize: "0.85rem", lineHeight: 1.6, marginTop: "12px", marginLeft: "20px" }}>
          <li>Only restaurants with verified Page Access Tokens can have posts published automatically.</li>
          <li>Content generation uses the latest verified details for each specific restaurant.</li>
          <li>Generation limits are strictly enforced per Place ID to prevent API exhaustion.</li>
        </ul>
        <p style={{ color: "#aaa", fontSize: "0.9rem", lineHeight: 1.6, marginTop: "16px" }}>
          Manage schedules under the <strong>Schedules</strong> tab.
        </p>
      </div>
    </div>
  );
}
