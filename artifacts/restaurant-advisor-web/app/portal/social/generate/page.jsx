"use client";

import { useState } from "react";

export default function GeneratePost() {
  const [post, setPost] = useState(null);
  const [status, setStatus] = useState("");

  const generate = async () => {
    const res = await fetch("/api/social/generate", { method: "POST" });
    const data = await res.json();
    setPost(data.post);
  };

  const schedule = async () => {
    const res = await fetch("/api/social/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(post)
    });

    const data = await res.json();
    setStatus(data.message);
  };

  return (
    <div>
      <h1>Generate Social Media Post</h1>

      <button className="upgrade-button" onClick={generate}>
        Generate Post
      </button>

      {post && (
        <div className="social-post">
          <h3>Generated Post</h3>
          <p>{post.caption}</p>
          <p><strong>Hashtags:</strong> {post.hashtags.join(" ")}</p>
        </div>
      )}

      {post && (
        <button className="upgrade-button" onClick={schedule}>
          Schedule Post
        </button>
      )}

      {status && <p>{status}</p>}
    </div>
  );
}