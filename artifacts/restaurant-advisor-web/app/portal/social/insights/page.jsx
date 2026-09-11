"use client";

import { useEffect, useState } from "react";

export default function AIInsights() {
  const [insights, setInsights] = useState(null);

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/social/insights");
      const data = await res.json();
      setInsights(data);
    };

    load();
  }, []);

  if (!insights) return <p>Loading AI insights…</p>;

  return (
    <div>
      <h1>AI Insights</h1>
      <p>Your AI learns from performance and improves your content strategy.</p>

      <section className="upgrade-section">
        <h2>Top Performing Posts</h2>
        {insights.topPosts.map((post, i) => (
          <div key={i} className="social-post">
            <p><strong>{post.caption}</strong></p>
            <p>Likes: {post.likes}</p>
            <p>Comments: {post.comments}</p>
            <p>Platform: {post.platform}</p>
          </div>
        ))}
      </section>

      <section className="upgrade-section">
        <h2>Best Posting Time</h2>
        <p>{insights.bestTime}</p>
      </section>

      <section className="upgrade-section">
        <h2>Best Platform</h2>
        <p>{insights.bestPlatform}</p>
      </section>

      <section className="upgrade-section">
        <h2>AI Adjustments</h2>
        {insights.adjustments.map((adj, i) => (
          <p key={i}>• {adj}</p>
        ))}
      </section>

      <section className="upgrade-section">
        <h2>Recommendations</h2>
        {insights.recommendations.map((rec, i) => (
          <p key={i}>• {rec}</p>
        ))}
      </section>
    </div>
  );
}