import { useState } from "react";
import { fetchSocial } from "./api";

export function BrandAutomation({ onQueueRefresh }: { onQueueRefresh?: () => void }) {
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
        body: JSON.stringify({ scope: "brand", platform })
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
      <div className="social-card" style={{ background: "linear-gradient(145deg, #1f1410, #171717)" }}>
        <h2>Brand Content Generator</h2>
        <p style={{ color: "#aaa", fontSize: "0.9rem", marginBottom: "20px", lineHeight: 1.5 }}>
          Use this tool to manually trigger the content generation engine for a general brand post. 
          This evaluates current trending data, new features, and broader highlights to draft an engaging post. 
          Generated posts are added to the Post Queue in a Draft state, waiting for explicit approval.
        </p>

        {error && <div className="social-alert">{error}</div>}

        <form onSubmit={handleGenerate}>
          <div className="social-form-group">
            <label>Platform</label>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="facebook">Facebook</option>
            </select>
          </div>
          <button type="submit" className="social-btn" disabled={generating}>
            {generating ? "Generating Draft..." : "Generate Brand Post Draft"}
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
    </div>
  );
}
