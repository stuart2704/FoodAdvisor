import { useEffect, useState } from "react";
import { fetchSocial } from "./api";

export function BrandAutomation({ onQueueRefresh }: { onQueueRefresh?: () => void }) {
  const [platform, setPlatform] = useState("facebook");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<{ automation: boolean; workerConfigured: boolean; brandSchedulesEnabled: boolean } | null>(null);
  const [brandScheduleExists, setBrandScheduleExists] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const loadSettings = async () => {
    try {
      const [settingsData, schedulesData] = await Promise.all([
        fetchSocial<{ settings: { automation: boolean; workerConfigured: boolean; brandSchedulesEnabled: boolean } }>("/settings"),
        fetchSocial<{ schedules: { restaurantId: string | null; platform: string }[] }>("/schedules"),
      ]);
      setSettings(settingsData.settings);
      setBrandScheduleExists(schedulesData.schedules.some(s => s.restaurantId === null && s.platform === "facebook"));
      setSettingsError("");
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Could not load automation settings.");
    }
  };

  useEffect(() => { void loadSettings(); }, []);

  const toggleMasterAutomation = async () => {
    if (!settings) return;
    const enable = !settings.automation;
    if (!window.confirm(enable
      ? "Enable master automation? Only do this after verifying the external scheduled job in production. Enabled schedules may publish Facebook posts without review."
      : "Turn off master automation? All scheduled posts will return to drafts. A publishing request already in progress may still finish."
    )) return;
    setSaving(true);
    setSettingsMessage("");
    setSettingsError("");
    try {
      const result = await fetchSocial<{ returnedToDrafts: number }>("/settings", {
        method: "POST",
        body: JSON.stringify({ automation: enable }),
      });
      setSettingsMessage(enable
        ? `Master automation enabled. ${result.returnedToDrafts} overdue post(s) returned to drafts for review. Automatic publishing also requires the external scheduled job.`
        : `Master automation off. ${result.returnedToDrafts} post(s) returned to drafts.`);
      await loadSettings();
      if (onQueueRefresh) onQueueRefresh();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Could not update master automation.");
    } finally {
      setSaving(false);
    }
  };

  const toggleBrandAutomation = async () => {
    if (!settings) return;
    const enable = !settings.brandSchedulesEnabled;
    if (!window.confirm(enable
      ? "Enable brand automation? If the server worker is turned on, brand posts may be generated and published at configured times."
      : "Turn off brand automation? Brand schedules will pause and scheduled brand posts will return to drafts. A publishing request already in progress may still finish."
    )) return;
    setSaving(true);
    setSettingsMessage("");
    setSettingsError("");
    try {
      const result = await fetchSocial<{ returnedToDrafts: number }>("/settings", {
        method: "POST",
        body: JSON.stringify({ brandAutomation: enable }),
      });
      setSettingsMessage(enable ? "Brand schedule enabled." : `Brand automation off. ${result.returnedToDrafts} post(s) returned to drafts.`);
      await loadSettings();
      if (onQueueRefresh) onQueueRefresh();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Could not update brand automation.");
    } finally {
      setSaving(false);
    }
  };

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
      <div className="social-card">
        <h2>Brand Automation</h2>
        {settingsError && <div className="social-alert" role="alert">{settingsError}</div>}
        {settingsMessage && <div className="social-success" role="status">{settingsMessage}</div>}
        <p>
          Master automation: <strong>{settings ? (settings.automation ? "ON" : "OFF") : "Loading..."}</strong>
          {" · "}External runner gate: <strong>{settings ? (settings.workerConfigured ? "operator-verified (live status not monitored)" : "OFF") : "Loading..."}</strong>
        </p>
        <p style={{ color: "#aaa", fontSize: "0.85rem" }}>
          The master switch, server runner gate, and verified external scheduled job must all be on for background publishing.
          Turning the master switch off moves all scheduled posts back to drafts.
        </p>
        <button type="button" className="social-btn" disabled={!settings || saving}
          onClick={() => void toggleMasterAutomation()}>
          {saving ? "Saving..." : settings?.automation ? "Turn Master Automation Off" : "Turn Master Automation On"}
        </button>
        <hr style={{ border: 0, borderTop: "1px solid #333", margin: "22px 0" }} />
        <p>
          Brand schedule: <strong>{settings ? (settings.brandSchedulesEnabled ? "ON" : "OFF") : "Loading..."}</strong>
        </p>
        <p style={{ color: "#aaa", fontSize: "0.85rem" }}>
          Enabling a schedule does not start the external job. When the runner gate is off, no posts publish automatically.
          Turning brand automation off moves scheduled brand posts back to drafts.
        </p>
        {!brandScheduleExists && settings && <p>Create a brand schedule in the Schedules tab before turning this on.</p>}
        <button type="button" className="social-btn"
          disabled={!settings || saving || (!settings.brandSchedulesEnabled && !brandScheduleExists)}
          onClick={() => void toggleBrandAutomation()}>
          {saving ? "Saving..." : settings?.brandSchedulesEnabled ? "Turn Brand Automation Off" : "Turn Brand Automation On"}
        </button>
      </div>
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
