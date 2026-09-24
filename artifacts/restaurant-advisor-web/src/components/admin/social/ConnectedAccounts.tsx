import { useState, useEffect } from "react";
import { fetchSocial } from "./api";

interface Account {
  id: string;
  restaurantId: string | null;
  platform: string;
  displayName: string;
  createdAt: string;
  status: string;
  tokenExpiresAt?: string | null;
}

interface InstagramConfig {
  configured: boolean;
  redirectUri: string | null;
}

export function ConnectedAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [restaurantId, setRestaurantId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [instagramConfig, setInstagramConfig] = useState<InstagramConfig | null>(null);
  const [instagramRestaurantId, setInstagramRestaurantId] = useState("");
  const [instagramConnecting, setInstagramConnecting] = useState(false);
  const [instagramError, setInstagramError] = useState("");
  const [connectError, setConnectError] = useState("");
  const [connectSuccess, setConnectSuccess] = useState("");
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [disconnectMessage, setDisconnectMessage] = useState("");

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const [data, config] = await Promise.all([
        fetchSocial<{ accounts: Account[] }>("/accounts"),
        fetchSocial<InstagramConfig>("/instagram/config").catch(() => null),
      ]);
      setAccounts(data.accounts);
      setInstagramConfig(config);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
    const params = new URLSearchParams(window.location.search);
    const result = params.get("instagram");
    if (result) {
      if (result === "connected") setConnectSuccess("Instagram account connected. Publishing and automation remain unavailable.");
      else {
        const messages: Record<string, string> = {
          denied: "Instagram authorization was cancelled or denied.",
          state_error: "Instagram connection expired or could not be verified. Try connecting again.",
          configuration_error: "Instagram app settings are missing or invalid.",
          already_used: "This Instagram profile is already linked to another brand or restaurant.",
          authorization_error: "Instagram connection failed. Check the Meta app redirect URI and account permissions, then try again.",
        };
        setInstagramError(messages[result] ?? "Instagram connection failed.");
      }
      params.delete("instagram");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
    }
  }, []);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setConnectError("");
    setConnectSuccess("");
    try {
      const payload: { platform: string; accessToken: string; restaurantId?: string } = { platform: "facebook", accessToken };
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

  const handleInstagramConnect = async () => {
    setInstagramConnecting(true);
    setInstagramError("");
    setConnectSuccess("");
    try {
      const result = await fetchSocial<{ authorizationUrl: string }>("/instagram/start", {
        method: "POST",
        body: JSON.stringify(instagramRestaurantId.trim() ? { restaurantId: instagramRestaurantId.trim() } : {}),
      });
      window.location.assign(result.authorizationUrl);
    } catch (err) {
      setInstagramError(err instanceof Error ? err.message : "Could not start Instagram connection.");
      setInstagramConnecting(false);
    }
  };

  const handleDisconnect = async (account: Account) => {
    if (!window.confirm(
      `Disconnect ${account.displayName || account.platform}? This removes its saved token. If this is the last connected account for its scope, schedules will be paused and scheduled posts returned to drafts. Publishing requests already in progress may still complete. This does not revoke the token at Meta.`
    )) return;
    setDisconnectingId(account.id);
    setDisconnectMessage("");
    try {
      const result = await fetchSocial<{ success: boolean; pausedSchedules: number; returnedToDrafts: number }>("/accounts/disconnect", {
        method: "POST",
        body: JSON.stringify({ accountId: account.id }),
      });
      setDisconnectMessage(`Disconnected. ${result.pausedSchedules} schedule(s) paused; ${result.returnedToDrafts} scheduled post(s) returned to drafts.`);
      await loadAccounts();
    } catch (err) {
      setDisconnectMessage(`Error: ${err instanceof Error ? err.message : "Could not disconnect account."}`);
    } finally {
      setDisconnectingId(null);
    }
  };

  return (
    <div>
      <div className="social-card">
        <h2>Connect Instagram</h2>
        <p style={{ color: "#aaa", fontSize: "0.9rem" }}>
          Sign in with a Business or Creator Instagram account. This only connects the account;
          Instagram publishing and automated posts are not available yet.
        </p>
        <p>Instagram: <strong>{loading ? "Loading..." : accounts.some(account => account.platform === "instagram" && account.status === "connected") ? "Connected" : "Not Connected"}</strong></p>
        {instagramError && <div className="social-alert" role="alert">{instagramError}</div>}
        {instagramConfig === null ? <p>Instagram configuration could not be loaded.</p>
          : !instagramConfig.configured && <p>Instagram app credentials and an HTTPS redirect URI must be configured before connecting.</p>}
        {instagramConfig?.redirectUri && <p style={{ color: "#aaa", fontSize: "0.8rem", overflowWrap: "anywhere" }}>
          Add this exact OAuth redirect URI in Meta App Dashboard → Instagram → API setup with Instagram login: {instagramConfig.redirectUri}
        </p>}
        <div className="social-form-group">
          <label htmlFor="instagram-restaurant">Restaurant Place ID (optional)</label>
          <input id="instagram-restaurant" type="text" value={instagramRestaurantId}
            onChange={e => setInstagramRestaurantId(e.target.value)} placeholder="Leave blank for The Food Advisor brand" />
        </div>
        <button type="button" className="social-btn" disabled={!instagramConfig?.configured || instagramConnecting}
          onClick={() => void handleInstagramConnect()}>
          {instagramConnecting ? "Opening Instagram..." : "Connect Instagram"}
        </button>
      </div>
      <div className="social-card">
        <h2>Connect Facebook Page</h2>
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
        {disconnectMessage && (
          <div className={disconnectMessage.startsWith("Error:") ? "social-alert" : "social-success"} role="status">
            {disconnectMessage}
          </div>
        )}
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
                    <th>Actions</th>
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
                      <td>
                        {acc.tokenExpiresAt && <div style={{ fontSize: "0.75rem", marginTop: 4 }}>
                          Token expires: {new Date(acc.tokenExpiresAt).toLocaleString()}
                        </div>}
                        {(acc.status === "connected" || acc.status === "expired") && (
                          <button type="button" className="social-btn" disabled={disconnectingId !== null}
                            onClick={() => void handleDisconnect(acc)}>
                            {disconnectingId === acc.id ? "Disconnecting..." : "Disconnect"}
                          </button>
                        )}
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
