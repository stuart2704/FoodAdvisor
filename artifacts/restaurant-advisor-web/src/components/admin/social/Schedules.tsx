import { useState, useEffect } from "react";
import { fetchSocial } from "./api";

interface Schedule {
  id: string;
  restaurantId: string;
  platform: string;
  frequency: string;
  timeOfDay: string;
  enabled: boolean;
}

export function Schedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [restaurantId, setRestaurantId] = useState("");
  const [platform, setPlatform] = useState("facebook");
  const [frequency, setFrequency] = useState("daily");
  const [timeOfDay, setTimeOfDay] = useState("12:00");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const loadSchedules = async () => {
    try {
      setLoading(true);
      const data = await fetchSocial<{ schedules: Schedule[] }>("/schedules");
      setSchedules(data.schedules);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSchedules();
  }, []);

  const handleEdit = (s: Schedule) => {
    setEditingId(s.id);
    setRestaurantId(s.restaurantId || "");
    setPlatform(s.platform || "facebook");
    setFrequency(s.frequency || "daily");
    setTimeOfDay(s.timeOfDay || "12:00");
    setEnabled(s.enabled || false);
    setSaveMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setRestaurantId("");
    setFrequency("daily");
    setTimeOfDay("12:00");
    setEnabled(false);
    setSaveMessage("");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMessage("");
    try {
      const payload: any = { platform, frequency, timeOfDay, enabled };
      if (restaurantId.trim()) payload.restaurantId = restaurantId.trim();
      if (editingId) payload.id = editingId;

      await fetchSocial("/schedules", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setSaveMessage(`Schedule ${editingId ? 'updated' : 'created'} successfully.`);
      handleCancelEdit();
      loadSchedules();
    } catch (err: any) {
      setSaveMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="social-card">
        <h2>{editingId ? "Edit Publishing Schedule" : "Create Publishing Schedule"}</h2>
        <p style={{ color: "#aaa", fontSize: "0.85rem", marginBottom: "16px" }}>
          <strong>Note:</strong> Enabling a schedule row does not start the scheduler if the worker is disabled on Autoscale. 
          Automatic jobs will only run when both explicitly enabled here and the worker is active.
        </p>
        {saveMessage && (
          <div className={saveMessage.startsWith("Error") ? "social-alert" : "social-success"}>
            {saveMessage}
          </div>
        )}
        <form onSubmit={handleSave}>
          <div className="social-form-group">
            <label>Place ID / Restaurant ID</label>
            <input 
              type="text" 
              value={restaurantId}
              onChange={(e) => setRestaurantId(e.target.value)}
              placeholder="Leave blank for Brand schedule"
            />
          </div>
          <div className="social-form-group">
            <label>Platform</label>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="facebook">Facebook</option>
              <option value="instagram" disabled={!restaurantId.trim()}>Instagram (restaurant photo required)</option>
              <option value="tiktok" disabled={!restaurantId.trim()}>TikTok (restaurant photo and privacy choice required)</option>
            </select>
          </div>
          <div className="social-form-group">
            <label>Frequency</label>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              <option value="daily">Daily</option>
            </select>
          </div>
          <div className="social-form-group">
            <label>Time of Day (UTC)</label>
            <input 
              type="time" 
              required 
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
            />
          </div>
          <div className="social-form-group" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input 
              type="checkbox" 
              id="schedule-enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: "auto" }}
            />
            <label htmlFor="schedule-enabled" style={{ margin: 0, fontWeight: "normal" }}>Enabled</label>
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <button type="submit" className="social-btn" disabled={saving}>
              {saving ? "Saving..." : (editingId ? "Update Schedule" : "Create Schedule")}
            </button>
            {editingId && (
              <button type="button" className="social-btn social-btn-secondary" onClick={handleCancelEdit} disabled={saving}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="social-card">
        <h2>Active Schedules</h2>
        {loading ? <p>Loading schedules...</p> : error ? <div className="social-alert">{error}</div> : (
          schedules.length === 0 ? <p className="social-empty">No schedules configured.</p> : (
            <div className="social-table-wrap">
              <table className="social-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Restaurant</th>
                    <th>Platform</th>
                    <th>Schedule</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map(s => (
                    <tr key={s.id}>
                      <td>{s.id}</td>
                      <td>{s.restaurantId ? s.restaurantId : <span style={{ color: "#aaa", fontStyle: "italic" }}>Brand (Global)</span>}</td>
                      <td><span className={`social-badge ${s.platform}`}>{s.platform}</span></td>
                      <td>{s.frequency} at {s.timeOfDay} (UTC)</td>
                      <td>
                        <span className={`social-badge ${s.enabled ? 'published' : 'error'}`}>
                          {s.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td>
                        <button 
                          className="social-btn social-btn-secondary" 
                          onClick={() => handleEdit(s)}
                          style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
