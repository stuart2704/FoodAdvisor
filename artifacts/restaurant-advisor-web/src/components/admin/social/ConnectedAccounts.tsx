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

interface OAuthConfig {
  configured: boolean;
  redirectUri: string | null;
}

export function ConnectedAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [facebookRestaurantId, setFacebookRestaurantId] = useState("");
  const [facebookConfig, setFacebookConfig] = useState<OAuthConfig | null>(null);
  const [facebookPages, setFacebookPages] = useState<{ id: string; name: string }[]>([]);
  const [facebookConnecting, setFacebookConnecting] = useState(false);
  const [facebookSelecting, setFacebookSelecting] = useState(false);
  const [instagramConfig, setInstagramConfig] = useState<OAuthConfig | null>(null);
  const [instagramRestaurantId, setInstagramRestaurantId] = useState("");
  const [instagramConnecting, setInstagramConnecting] = useState(false);
  const [instagramError, setInstagramError] = useState("");
  const [facebookError, setFacebookError] = useState("");
  const [connectSuccess, setConnectSuccess] = useState("");
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [disconnectMessage, setDisconnectMessage] = useState("");

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const [data, config, fbConfig] = await Promise.all([
        fetchSocial<{ accounts: Account[] }>("/accounts"),
        fetchSocial<OAuthConfig>("/instagram/config").catch(() => null),
        fetchSocial<OAuthConfig>("/facebook/config").catch(() => null),
      ]);
      setAccounts(data.accounts);
      setInstagramConfig(config);
      setFacebookConfig(fbConfig);
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
    const facebookResult = params.get("facebook");
    if (facebookResult) {
      const messages: Record<string, string> = {
        denied: "Facebook authorization was cancelled or denied.",
        state_error: "Facebook connection expired or could not be verified. Try connecting again.",
        configuration_error: "Facebook app settings are missing or invalid.",
        no_pages: "No Pages with permission to create posts were found. Check your Page role and Meta app permissions.",
        authorization_error: "Facebook connection failed. Check the Meta app redirect URI, Page permissions, and app access.",
      };
      if (facebookResult === "select") {
        void fetchSocial<{ pages: { id: string; name: string }[] }>("/facebook/pages")
          .then(data => setFacebookPages(data.pages))
          .catch(err => setFacebookError(err instanceof Error ? err.message : "Could not load Facebook Pages."));
      } else setFacebookError(messages[facebookResult] ?? "Facebook connection failed.");
      params.delete("facebook");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    }
  }, []);

  const handleFacebookConnect = async () => {
    setFacebookConnecting(true);
    setFacebookError("");
    setConnectSuccess("");
    try {
      const result = await fetchSocial<{ authorizationUrl: string }>("/facebook/start", {
        method: "POST",
        body: JSON.stringify(facebookRestaurantId.trim() ? { restaurantId: facebookRestaurantId.trim() } : {}),
      });
      window.location.assign(result.authorizationUrl);
    } catch (err) {
      setFacebookError(err instanceof Error ? err.message : "Could not start Facebook connection.");
      setFacebookConnecting(false);
    }
  };

  const handleFacebookPage = async (pageId: string) => {
    setFacebookSelecting(true);
    setFacebookError("");
    try {
      const result = await fetchSocial<{ pageName: string }>("/facebook/finish", {
        method: "POST",
        body: JSON.stringify({ pageId }),
      });
      setFacebookPages([]);
      setFacebookRestaurantId("");
      setConnectSuccess(`${result.pageName} connected to Facebook.`);
      await loadAccounts();
    } catch (err) {
      setFacebookError(err instanceof Error ? err.message : "Could not connect Facebook Page.");
    } finally {
      setFacebookSelecting(false);
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
        <p style={{ color: "#aaa", fontSize: "0.9rem" }}>
          Sign in with Facebook and choose a Page you manage. No Page access token needs to be copied.
        </p>
        <p>Facebook: <strong>{loading ? "Loading..." : accounts.some(account => account.platform === "facebook" && account.status === "connected") ? "Connected" : "Not Connected"}</strong></p>
        {facebookError && <div className="social-alert" role="alert">{facebookError}</div>}
        {connectSuccess && <div className="social-success">{connectSuccess}</div>}
        {facebookConfig === null ? <p>Facebook configuration could not be loaded.</p>
          : !facebookConfig.configured && <p>Facebook app credentials and an HTTPS redirect URI must be configured before connecting.</p>}
        {facebookConfig?.redirectUri && <p style={{ color: "#aaa", fontSize: "0.8rem", overflowWrap: "anywhere" }}>
          Add this exact OAuth redirect URI in Meta App Dashboard → Facebook Login for Business → Settings: {facebookConfig.redirectUri}
        </p>}
        {facebookPages.length > 0 ? (
          <div>
            <p>Choose the Page to connect:</p>
            {facebookPages.map(page => (
              <button key={page.id} type="button" className="social-btn" disabled={facebookSelecting}
                onClick={() => void handleFacebookPage(page.id)}>
                {facebookSelecting ? "Connecting..." : `Connect ${page.name}`}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="social-form-group">
              <label htmlFor="facebook-restaurant">Restaurant Place ID (optional)</label>
              <input id="facebook-restaurant" type="text" value={facebookRestaurantId}
                onChange={e => setFacebookRestaurantId(e.target.value)} placeholder="Leave blank for The Food Advisor brand" />
            </div>
            <button type="button" className="social-btn" disabled={!facebookConfig?.configured || facebookConnecting}
              onClick={() => void handleFacebookConnect()}>
              {facebookConnecting ? "Opening Facebook..." : "Connect Facebook Page"}
            </button>
          </>
        )}
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
