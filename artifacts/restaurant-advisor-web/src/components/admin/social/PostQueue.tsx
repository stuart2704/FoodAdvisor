import { useState, useEffect } from "react";
import { fetchSocial } from "./api";

interface Post {
  id: string;
  restaurantId: string | null;
  platform: string;
  content: string;
  mediaUrl?: string;
  mediaObjectPath?: string | null;
  mediaApprovedAt?: string | null;
  privacyLevel?: string | null;
  providerPostId?: string | null;
  status: string;
  scheduledFor?: string;
  publishedAt?: string;
  errorMessage?: string;
}

export function PostQueue() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "draft" | "scheduled" | "published" | "failed">("all");
  const [scheduleTimes, setScheduleTimes] = useState<Record<string, string>>({});
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [draftScope, setDraftScope] = useState<"brand" | "restaurant">("brand");
  const [restaurantId, setRestaurantId] = useState("");
  const [platform, setPlatform] = useState("facebook");
  const [privacyOptions, setPrivacyOptions] = useState<Record<string, { accountId: string; displayName: string; options: string[] }>>({});
  const [restaurantAccounts, setRestaurantAccounts] = useState<{ restaurantId: string; displayName?: string }[]>([]);
  const [generating, setGenerating] = useState(false);
  const [brandAccounts, setBrandAccounts] = useState<{ id: string; displayName: string }[]>([]);
  const [manualAccountId, setManualAccountId] = useState("");
  const [manualContent, setManualContent] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  const loadPosts = async () => {
    try {
      setLoading(true);
      const data = await fetchSocial<{ posts: Post[] }>("/posts");
      setPosts(data.posts);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPosts();
  }, []);

  useEffect(() => {
    if (filterTab !== "draft") return;
    void fetchSocial<{ accounts: { id: string; restaurantId: string | null; displayName: string; platform: string; status: string }[] }>("/accounts")
      .then(data => {
        const accounts = data.accounts.filter(account =>
          account.restaurantId === null && account.platform === "facebook" && account.status === "connected");
        setBrandAccounts(accounts);
        setManualAccountId(previous => accounts.some(account => account.id === previous) ? previous : accounts[0]?.id ?? "");
      })
      .catch(() => { setBrandAccounts([]); setManualAccountId(""); });
  }, [filterTab]);

  const saveManualDraft = async () => {
    if (!manualAccountId || !manualContent.trim()) return;
    setSavingManual(true);
    setActionMessage("");
    try {
      await fetchSocial("/posts/draft", {
        method: "POST",
        body: JSON.stringify({ accountId: manualAccountId, content: manualContent }),
      });
      setManualContent("");
      setActionMessage("Facebook brand draft saved. Review its exact text below before choosing Publish Now.");
      await loadPosts();
    } catch (err) {
      setActionMessage(`Failed: ${err instanceof Error ? err.message : "Could not save the draft."}`);
    } finally {
      setSavingManual(false);
    }
  };

  useEffect(() => {
    if (filterTab !== "draft") return;
    void fetchSocial<{ accounts: { restaurantId: string | null; displayName?: string; platform: string; status: string }[] }>("/accounts")
      .then(data => {
        const unique = new Map<string, { restaurantId: string; displayName?: string }>();
        for (const account of data.accounts) {
          if (account.restaurantId && account.platform === platform && account.status === "connected") {
            unique.set(account.restaurantId, { restaurantId: account.restaurantId, displayName: account.displayName });
          }
        }
        setRestaurantAccounts([...unique.values()]);
      })
      .catch(() => setRestaurantAccounts([]));
  }, [filterTab, platform]);

  const handleGenerate = async () => {
    if (draftScope === "restaurant" && !restaurantId) {
      setActionMessage("Failed: Select a connected restaurant.");
      return;
    }
    setGenerating(true);
    setActionMessage("");
    try {
      await fetchSocial("/posts/generate", {
        method: "POST",
        body: JSON.stringify({
           scope: draftScope, platform,
          ...(draftScope === "restaurant" ? { restaurantId } : {}),
        }),
      });
      setActionMessage("Draft generated. Review it below before publishing.");
      setShowGenerate(false);
      await loadPosts();
    } catch (err) {
      setActionMessage(`Failed: ${err instanceof Error ? err.message : "Could not generate draft."}`);
    } finally {
      setGenerating(false);
    }
  };
  const loadPrivacy = async (postId: string) => {
    try {
      const data = await fetchSocial<{ accountId: string; displayName: string; privacyOptions: string[] }>(`/posts/${postId}/tiktok-options`);
      setPrivacyOptions(previous => ({ ...previous, [postId]: { accountId: data.accountId, displayName: data.displayName, options: data.privacyOptions } }));
    } catch (err) { setActionMessage(`Failed: ${err instanceof Error ? err.message : "Could not read TikTok privacy options."}`); }
  };
  const setPrivacy = async (postId: string, privacyLevel: string) => {
    try {
      const accountId = privacyOptions[postId]?.accountId;
      if (!accountId) throw new Error("Load the TikTok creator options before approving privacy.");
      await fetchSocial(`/posts/${postId}/tiktok-privacy`, { method: "POST", body: JSON.stringify({ privacyLevel, accountId }) });
      setActionMessage(`TikTok privacy approved: ${privacyLevel}.`);
      await loadPosts();
    } catch (err) { setActionMessage(`Failed: ${err instanceof Error ? err.message : "Could not approve privacy."}`); }
  };
  const checkStatus = async (postId: string) => {
    try {
      const result = await fetchSocial<{ providerStatus: string }>(`/posts/${postId}/status`, { method: "POST" });
      setActionMessage(`TikTok status: ${result.providerStatus}. Do not resend while processing.`);
      await loadPosts();
    } catch (err) { setActionMessage(`Failed: ${err instanceof Error ? err.message : "Could not check TikTok status."}`); }
  };

  const handlePublish = async (postId: string) => {
    const post = posts.find(p => p.id === postId);
    if (!window.confirm(post?.platform === "tiktok"
      ? `Submit this photo as a TikTok post with ${post.privacyLevel} privacy and comments disabled? TikTok may process it asynchronously.`
      : `Publish this ${post?.platform ?? "social"} post immediately?`)) return;
    try {
      setActionMessage("Publishing...");
      await fetchSocial("/posts/publish", {
        method: "POST",
        body: JSON.stringify({ postId })
      });
      setActionMessage("Submission recorded. Check the post status; TikTok may still be processing.");
      loadPosts();
    } catch (err: any) {
      setActionMessage(`Failed: ${err.message}`);
    }
  };

  const handlePhotoApproval = async (post: Post) => {
    const approved = !post.mediaApprovedAt;
    if (approved && !window.confirm(`Make this approved chef photo publicly accessible for this ${post.platform} post? Anyone with the image URL can view it while approval remains active.`)) return;
    if (!approved && post.status === "published" && !window.confirm(`Revoke access to this image URL? This will not remove any photo ${post.platform} has already copied. Remove the provider post separately if needed.`)) return;
    try {
      setActionMessage("");
      await fetchSocial(`/posts/${post.id}/photo-approval`, {
        method: "POST", body: JSON.stringify({ approved }),
      });
      setActionMessage(approved ? "Photo approved for this post. Review the draft before publishing." : "Image URL access revoked. Any copy already on the provider remains there.");
      await loadPosts();
    } catch (err) {
      setActionMessage(`Failed: ${err instanceof Error ? err.message : "Could not update photo approval."}`);
    }
  };

  const handleSchedule = async (postId: string) => {
    const localTime = scheduleTimes[postId];
    const scheduledFor = localTime ? new Date(localTime) : null;
    if (!scheduledFor || !Number.isFinite(scheduledFor.getTime()) || scheduledFor <= new Date()) {
      setActionMessage("Failed: Choose a future date and time.");
      return;
    }
    if (!window.confirm(`Schedule this post for ${scheduledFor.toLocaleString()}? Master automation must be on, and it will publish automatically only if the server worker is configured.`)) return;
    setSchedulingId(postId);
    setActionMessage("");
    try {
      await fetchSocial("/posts/schedule", {
        method: "POST",
        body: JSON.stringify({ postId, time: scheduledFor.toISOString() }),
      });
      setActionMessage(`Post scheduled for ${scheduledFor.toLocaleString()}.`);
      setScheduleTimes(prev => { const next = { ...prev }; delete next[postId]; return next; });
      await loadPosts();
    } catch (err) {
      setActionMessage(`Failed: ${err instanceof Error ? err.message : "Could not schedule post."}`);
    } finally {
      setSchedulingId(null);
    }
  };

  const filteredPosts = posts.filter(p => {
    if (filterTab === "all") return true;
    if (filterTab === "draft") return p.status === "draft" || p.status === "pending";
    return p.status === filterTab;
  });

  return (
    <div>
      <div className="social-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ margin: 0 }}>Post Queue</h2>
          <div className="social-tabs" style={{ borderBottom: "none", paddingBottom: 0, overflowX: "visible" }}>
            {(["all", "draft", "scheduled", "published", "failed"] as const).map(tab => (
              <button 
                key={tab} 
                className={`social-tab ${filterTab === tab ? "active" : ""}`}
                onClick={() => setFilterTab(tab)}
                style={{ padding: "6px 12px", fontSize: "0.8rem" }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <p style={{ color: "#aaa", fontSize: "0.85rem", marginBottom: "16px" }}>
          Draft generation does not publish. Timed publishing requires both master automation and the server worker;
          an admin can still choose Publish Now while automation is off.
        </p>
        {filterTab === "draft" && (
          <div style={{ display: "grid", gap: 10, maxWidth: 560, marginBottom: 22 }}>
            <h3 style={{ margin: 0 }}>Write a Facebook brand draft</h3>
            <label htmlFor="manual-facebook-page">Facebook Page</label>
            <select id="manual-facebook-page" value={manualAccountId}
              onChange={event => setManualAccountId(event.target.value)}>
              {brandAccounts.length === 0 && <option value="">No connected Facebook brand Page</option>}
              {brandAccounts.map(account => <option key={account.id} value={account.id}>{account.displayName}</option>)}
            </select>
            <label htmlFor="manual-facebook-content">Post text</label>
            <textarea id="manual-facebook-content" value={manualContent} maxLength={5000} rows={5}
              onChange={event => setManualContent(event.target.value)}
              placeholder="Enter the exact text you want to post" />
            <button type="button" className="social-btn"
              disabled={savingManual || !manualAccountId || !manualContent.trim()}
              onClick={() => void saveManualDraft()}>{savingManual ? "Saving..." : "Save Draft"}</button>
            <p style={{ color: "#aaa", fontSize: "0.85rem", margin: 0 }}>
              Saving does not publish. Review the draft in the queue, then choose Publish Now when ready.
            </p>
          </div>
        )}
        {filterTab === "draft" && (
          <div style={{ marginBottom: 18 }}>
            <button type="button" className="social-btn" onClick={() => setShowGenerate(value => !value)}>
              {showGenerate ? "Cancel" : "Generate Draft"}
            </button>
            {showGenerate && (
              <div style={{ display: "grid", gap: 10, maxWidth: 400, marginTop: 14 }}>
                <label htmlFor="draft-scope">Draft for</label>
                <select id="draft-scope" value={draftScope}
                  onChange={e => { setDraftScope(e.target.value as "brand" | "restaurant"); if (e.target.value === "brand") setPlatform("facebook"); }}>
                  <option value="brand">The Food Advisor brand</option>
                  <option value="restaurant">Connected restaurant</option>
                </select>
                <label htmlFor="draft-platform">Platform</label>
                <select id="draft-platform" value={platform} onChange={e => { setPlatform(e.target.value); setRestaurantId(""); }}>
                  <option value="facebook">Facebook</option>
                  <option value="instagram" disabled={draftScope === "brand"}>Instagram</option>
                  <option value="tiktok" disabled={draftScope === "brand"}>TikTok</option>
                </select>
                {draftScope === "restaurant" && (
                  <>
                    <label htmlFor="draft-restaurant">Restaurant</label>
                    <select id="draft-restaurant" value={restaurantId} onChange={e => setRestaurantId(e.target.value)}>
                      <option value="">Select a connected restaurant</option>
                      {restaurantAccounts.map(account => (
                        <option key={account.restaurantId} value={account.restaurantId}>
                          {account.displayName || account.restaurantId}
                        </option>
                      ))}
                    </select>
                    {restaurantAccounts.length === 0 && <p>Connect a restaurant {platform} account in Connected Accounts first.</p>}
                  </>
                )}
                <p style={{ color: "#aaa", fontSize: "0.85rem", margin: 0 }}>Generated drafts require review. Instagram and TikTok require a restaurant with an approved chef photo; brand text-only drafts cannot publish there.</p>
                <button type="button" className="social-btn" disabled={generating || (draftScope === "restaurant" && !restaurantId)}
                  onClick={() => void handleGenerate()}>{generating ? "Generating..." : "Generate Draft"}</button>
              </div>
            )}
          </div>
        )}
        
        {actionMessage && (
          <div className={actionMessage.startsWith("Failed") ? "social-alert" : "social-success"}>
            {actionMessage}
          </div>
        )}

        {loading ? <p>Loading queue...</p> : error ? <div className="social-alert">{error}</div> : (
          filteredPosts.length === 0 ? <p className="social-empty">No posts found for this filter.</p> : (
            <div className="social-table-wrap">
              <table className="social-table">
                <thead>
                  <tr>
                    <th>ID / Platform</th>
                    <th>Restaurant</th>
                    <th>Content</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPosts.map(p => (
                    <tr key={p.id}>
                      <td>
                        <div>{p.id}</div>
                        <span className={`social-badge ${p.platform}`} style={{ marginTop: "4px" }}>{p.platform}</span>
                      </td>
                      <td>{p.restaurantId ? p.restaurantId : <span style={{ color: "#aaa", fontStyle: "italic" }}>Brand (Global)</span>}</td>
                      <td style={{ maxWidth: "300px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {p.content}
                        {p.mediaUrl && (
                          <div style={{ marginTop: "8px" }}>
                            <a href={p.mediaUrl} target="_blank" rel="noreferrer" style={{ color: "#ff8b47" }}>View Media</a>
                          </div>
                        )}
                        {p.mediaObjectPath && <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#aaa" }}>
                          {p.mediaApprovedAt ? "Chef photo approved for publication" : "Chef photo available; publication not approved"}
                        </div>}
                      </td>
                      <td>
                        <span className={`social-badge ${
                          p.status === 'published' ? 'published' : 
                          p.status === 'failed' ? 'error' : 'pending'
                        }`}>
                          {p.status}
                        </span>
                        {p.scheduledFor && <div style={{ fontSize: "0.75rem", marginTop: "4px", color: "#aaa" }}>Scheduled: {new Date(p.scheduledFor).toLocaleString()}</div>}
                        {p.publishedAt && <div style={{ fontSize: "0.75rem", marginTop: "4px", color: "#aaa" }}>Published: {new Date(p.publishedAt).toLocaleString()}</div>}
                        {p.providerPostId && <div style={{ fontSize: "0.75rem", overflowWrap: "anywhere" }}>Provider ID: {p.providerPostId}</div>}
                        {p.errorMessage && <div style={{ fontSize: "0.75rem", marginTop: "4px", color: "#ff9b8d" }}>{p.errorMessage}</div>}
                      </td>
                      <td>
                        {p.mediaObjectPath && (p.status === "draft" || (p.mediaApprovedAt && p.status !== "publishing")) &&
                          <button type="button" className="social-btn social-btn-secondary"
                            onClick={() => void handlePhotoApproval(p)}>
                             {p.mediaApprovedAt ? "Revoke photo approval" : `Approve chef photo for ${p.platform}`}
                          </button>}
                        {p.platform === "tiktok" && p.status === "draft" && (
                          <div style={{ display: "grid", gap: 6 }}>
                            <button type="button" className="social-btn social-btn-secondary" onClick={() => void loadPrivacy(p.id)}>Load TikTok privacy choices</button>
                            {privacyOptions[p.id] && <>
                              <span>Posting as {privacyOptions[p.id].displayName}</span>
                              <select aria-label={`Privacy for ${p.id}`} value={p.privacyLevel ?? ""}
                                onChange={e => { if (e.target.value) void setPrivacy(p.id, e.target.value); }}>
                                <option value="">Choose privacy and approve</option>
                                {privacyOptions[p.id].options.map(option => <option key={option} value={option}>{option}</option>)}
                              </select>
                            </>}
                          </div>
                        )}
                        {p.platform === "tiktok" && p.status === "publishing" && p.providerPostId &&
                          <button type="button" className="social-btn social-btn-secondary" onClick={() => void checkStatus(p.id)}>Check TikTok status</button>}
                         {(p.status === 'draft' || p.status === 'pending' || p.status === 'scheduled') && (
                          <button 
                            className="social-btn social-btn-secondary" 
                             disabled={p.platform !== "facebook" && (!p.mediaApprovedAt || !p.mediaUrl || (p.platform === "tiktok" && !p.privacyLevel))}
                             onClick={() => handlePublish(p.id)}
                            style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                          >
                            Publish Now
                          </button>
                        )}
                        {p.status === "draft" && (
                          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                            <label htmlFor={`schedule-${p.id}`} style={{ fontSize: "0.8rem" }}>Schedule (your local time)</label>
                            <input
                              id={`schedule-${p.id}`}
                              type="datetime-local"
                              value={scheduleTimes[p.id] ?? ""}
                              onChange={e => setScheduleTimes(prev => ({ ...prev, [p.id]: e.target.value }))}
                            />
                            <button type="button" className="social-btn social-btn-secondary"
                              disabled={schedulingId !== null || !scheduleTimes[p.id]}
                              onClick={() => void handleSchedule(p.id)}>
                              {schedulingId === p.id ? "Scheduling..." : "Schedule"}
                            </button>
                          </div>
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
