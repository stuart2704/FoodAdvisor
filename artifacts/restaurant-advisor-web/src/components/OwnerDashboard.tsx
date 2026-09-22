import { useState } from "react";

export default function OwnerDashboard() {
  const [seoText, setSeoText] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialPosts, setSocialPosts] = useState("");
  const [tone, setTone] = useState("friendly");
  const [loadingSocial, setLoadingSocial] = useState(false);

  function generateSEO() {
    setLoading(true);

    fetch("https://the-food-advisor-api.onrender.com/ai/seo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Your Restaurant Name",
        city: "Your City",
        cuisine: "Your Cuisine",
        rating: 4.7
      })
    })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "SEO text could not be generated.");
        }
        return data;
      })
      .then(data => setSeoText(data.seo))
      .catch(() => setSeoText("SEO text could not be generated right now."))
      .finally(() => setLoading(false));
  }

  function generateSocial() {
    setLoadingSocial(true);
    setSocialPosts("");

    fetch("https://the-food-advisor-api.onrender.com/ai/social", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Your Restaurant Name",
        city: "Your City",
        cuisine: "Your Cuisine",
        tone
      })
    })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Social posts could not be generated.");
        }
        return data;
      })
      .then(data => setSocialPosts(data.posts))
      .catch(() =>
        setSocialPosts("Social posts could not be generated right now.")
      )
      .finally(() => setLoadingSocial(false));
  }

  return (
    <div className="section">
      <h1>Restaurant Owner Dashboard</h1>
      <p>Manage your listing, add photos, menus, opening hours, and more.</p>

      <div
        style={{
          marginTop: "40px",
          background: "#fff",
          padding: "24px",
          borderRadius: "16px"
        }}
      >
        <h2>AI‑Generated SEO Text</h2>
        <p>Boost your visibility on Google with AI‑optimised content.</p>

        <button
          onClick={generateSEO}
          disabled={loading}
          style={{
            padding: "12px 20px",
            background: "#d94800",
            color: "#fff",
            borderRadius: "8px",
            border: "none",
            cursor: loading ? "wait" : "pointer",
            marginTop: "12px",
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? "Generating…" : "Generate SEO Text"}
        </button>

        {seoText && (
          <div
            style={{
              marginTop: "24px",
              whiteSpace: "pre-wrap",
              lineHeight: "1.6"
            }}
          >
            {seoText}
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: "40px",
          background: "#fff",
          padding: "24px",
          borderRadius: "16px"
        }}
      >
        <h2>AI Social Media Posts</h2>
        <p>Generate ready-to-post content for Instagram, Facebook, and TikTok.</p>

        <label style={{ display: "block", marginTop: "12px" }}>
          Tone:
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            style={{
              marginLeft: "12px",
              padding: "8px",
              borderRadius: "8px",
              border: "1px solid #ccc"
            }}
          >
            <option value="friendly">Friendly</option>
            <option value="luxury">Luxury</option>
            <option value="fun">Fun</option>
            <option value="romantic">Romantic</option>
            <option value="professional">Professional</option>
          </select>
        </label>

        <button
          onClick={generateSocial}
          disabled={loadingSocial}
          style={{
            padding: "12px 20px",
            background: "#d94800",
            color: "#fff",
            borderRadius: "8px",
            border: "none",
            cursor: loadingSocial ? "wait" : "pointer",
            marginTop: "12px",
            opacity: loadingSocial ? 0.7 : 1
          }}
        >
          {loadingSocial ? "Generating…" : "Generate Social Posts"}
        </button>

        {socialPosts && (
          <div
            style={{
              marginTop: "24px",
              whiteSpace: "pre-wrap",
              lineHeight: "1.6"
            }}
          >
            {socialPosts}
          </div>
        )}
      </div>
    </div>
  );
}