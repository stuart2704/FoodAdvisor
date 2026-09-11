"use client";

import { useEffect, useState } from "react";

export default function SocialMediaAI() {
  const [posts, setPosts] = useState([]);
  const [branding, setBranding] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [analytics, setAnalytics] = useState(null);

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/social");
      const data = await res.json();

      setPosts(data.posts);
      setBranding(data.branding);
      setSchedule(data.schedule);
      setAnalytics(data.analytics);
    };

    load();
  }, []);

  if (!branding) return <p>Loading…</p>;

  return (
    <div>
      <h1>Social Media AI</h1>
      <p>Your automated social media manager.</p>

      <section className="upgrade-section">
        <h2>Upcoming Posts</h2>
        {schedule.map((item, i) => (
          <div key={i} className="social-post">
            <p><strong>{item.date}</strong> — {item.platforms.join(", ")}</p>
            <p>{item.caption}</p>
          </div>
        ))}
      </section>

      <section className="upgrade-section">
        <h2>Branding Settings</h2>
        <p>Tone: {branding.tone}</p>
        <p>Emoji Style: {branding.emojis ? "Enabled" : "Disabled"}</p>
        <p>Hashtag Style: {branding.hashtagStyle}</p>

        <a className="upgrade-button" href="/portal/social/branding">
          Edit Branding
        </a>
      </section>

      <section className="upgrade-section">
        <h2>Analytics</h2>
        <p>Instagram Likes: {analytics.instagram.likes}</p>
        <p>Facebook Likes: {analytics.facebook.likes}</p>
        <p>Google Views: {analytics.google.views}</p>

        <a className="upgrade-button" href="/portal/social/analytics">
          View Full Analytics
        </a>
      </section>

      <section className="upgrade-section">
        <h2>Generate New Post</h2>
        <a className="upgrade-button" href="/portal/social/generate">
          Generate Post
        </a>
      </section>
    </div>
  );
}
