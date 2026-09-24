import { useState, useEffect } from "react";
import { fetchSocial } from "./api";

interface Account {
  id: string;
  restaurantId: string;
  platform: string;
  displayName: string;
  createdAt: string;
}

export function ConnectedAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [restaurantId, setRestaurantId] = useState("");
  const [platform, setPlatform] = useState("facebook");
  const [accessToken, setAccessToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [connectSuccess, setConnectSuccess] = useState("");

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const data = await fetchSocial<{ accounts: Account[] }>("/accounts");
      setAccounts(data.accounts);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setConnectError("");
    setConnectSuccess("");
    try {
      const payload: any = { platform, accessToken };
      if (restaurantId.trim()) {
        payload.restaurantId = restaurantId.trim();
      }

      await fetchSocial("/accounts/connect", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setConnectSuccess("Account connected successfully.");
      setRestaurantId("");
      setAccessToken("");
      loadAccounts();
    } catch (err: any) {
      setConnectError(err.message);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div>
      <div className="social-card">
        <h2>Connect New Account</h2>
        {connectError && <div className="social-alert">{connectError}</div>}
        {connectSuccess && <div className="social-success">{connectSuccess}</div>}
        <form onSubmit={handleConnect}>
          <div className="social-form-group">
            <label>Place ID / Restaurant ID</label>
            <input 
              type="text" 
              value={restaurantId}
              onChange={(e) => setRestaurantId(e.target.value)}
              placeholder="Leave blank for Brand account"
            />
          </div>
          <div className="social-form-group">
            <label>Platform</label>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="facebook">Facebook</option>
              <option value="instagram" disabled>Instagram (Unavailable)</option>
              <option value="tiktok" disabled>TikTok (Unavailable)</option>
            </select>
          </div>
          <div className="social-form-group">
            <label>Page Access Token</label>
            <input 
              type="password" 
              required 
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Paste token here"
              autoComplete="off"
            />
          </div>
          <button type="submit" className="social-btn" disabled={connecting}>
            {connecting ? "Connecting..." : "Connect Account"}
          </button>
        </form>
      </div>

      <div className="social-card">
        <h2>Connected Accounts</h2>
        {loading ? <p>Loading accounts...</p> : error ? <div className="social-alert">{error}</div> : (
          accounts.length === 0 ? <p className="social-empty">No accounts connected yet.</p> : (
            <div className="social-table-wrap">
              <table className="social-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Restaurant</th>
                    <th>Platform</th>
                    <th>Display Name</th>
                    <th>Connected At</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map(acc => (
                    <tr key={acc.id}>
                      <td>{acc.id}</td>
                      <td>{acc.restaurantId ? acc.restaurantId : <span style={{ color: "#aaa", fontStyle: "italic" }}>Brand (Global)</span>}</td>
                      <td><span className={`social-badge ${acc.platform}`}>{acc.platform}</span></td>
                      <td>{acc.displayName}</td>
                      <td>{new Date(acc.createdAt).toLocaleString()}</td>
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
