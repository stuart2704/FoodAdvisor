import { useState, useEffect } from "react";
import { fetchSocial } from "./api";

interface Post {
  id: string;
  restaurantId: string;
  platform: string;
  content: string;
  mediaUrl?: string;
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

  const handlePublish = async (postId: string) => {
    if (!window.confirm("Publish this post immediately?")) return;
    try {
      setActionMessage("Publishing...");
      await fetchSocial("/posts/publish", {
        method: "POST",
        body: JSON.stringify({ postId })
      });
      setActionMessage("Post published successfully!");
      loadPosts();
    } catch (err: any) {
      setActionMessage(`Failed: ${err.message}`);
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
          Posts will not be sent live unless an admin explicitly chooses to publish them, or automated sending is enabled via Schedules.
        </p>
        
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
                        {p.errorMessage && <div style={{ fontSize: "0.75rem", marginTop: "4px", color: "#ff9b8d" }}>{p.errorMessage}</div>}
                      </td>
                      <td>
                        {(p.status === 'draft' || p.status === 'pending' || p.status === 'scheduled') && (
                          <button 
                            className="social-btn social-btn-secondary" 
                            onClick={() => handlePublish(p.id)}
                            style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                          >
                            Publish Now
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
