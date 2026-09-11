// DRAFT ONLY: leave unrouted until paid upgrades and advertised features are verified.
import React from "react";

export default function UpgradePage() {
  return (
    <div style={{ padding: "40px", maxWidth: "900px", margin: "0 auto" }}>
      
      <header>
        <h1>Boost Your Restaurant’s Visibility Inside The Food Advisor App</h1>
        <p>
          Your free listing is live — now unlock priority placement, full menu
          integration, and a featured badge.
        </p>
      </header>

      <section>
        <h2>Why Upgrade?</h2>
        <p>
          Upgrading gives your restaurant premium visibility inside both our
          website directory and our mobile app.
        </p>

        <ul>
          <li>Priority placement in search results</li>
          <li>Full menu integration inside the app</li>
          <li>Featured badge for increased trust</li>
          <li>Enhanced profile with photos and booking links</li>
          <li>Instant updates to your listing</li>
        </ul>
      </section>

      <section>
        <h2>Restaurants already pay for visibility</h2>
        <p>
          Platforms like Deliveroo, Uber Eats, TripAdvisor, and Yelp charge for
          premium placement. The Food Advisor gives you the same advantage — at a
          fraction of the cost.
        </p>
      </section>

      <section>
        <h2>£99/month — Cancel Anytime</h2>
        <p>
          A simple, flat monthly subscription. No contracts. No hidden fees. No
          setup cost.
        </p>
      </section>

      <section>
        <h2>Included in your upgrade</h2>
        <ul>
          <li>
            <strong>Priority Placement:</strong> Appear above free listings.
          </li>
          <li>
            <strong>Featured Badge:</strong> Boost trust and click‑through rate.
          </li>
          <li>
            <strong>Menu Integration:</strong> Your menu displayed beautifully
            inside the app.
          </li>
          <li>
            <strong>Enhanced Profile:</strong> Photos, hours, booking links.
          </li>
          <li>
            <strong>Instant Updates:</strong> Changes appear immediately.
          </li>
          <li>
            <strong>Dedicated Support:</strong> We help optimise your listing.
          </li>
        </ul>
      </section>

      <section>
        <h2>Upgrade Now</h2>
        <p>Activate your premium listing and start reaching more diners today.</p>

        <a
          href="/upgrade/checkout"
          style={{
            padding: "12px 20px",
            background: "black",
            color: "white",
            textDecoration: "none",
            borderRadius: "6px",
            display: "inline-block",
            marginTop: "10px"
          }}
        >
          Upgrade for £99/month
        </a>
      </section>

      <section>
        <h2>Cancel Anytime — No Risk</h2>
        <p>
          If you don’t see value, cancel instantly. Your free listing stays live
          forever.
        </p>
      </section>

      <section>
        <h2>FAQ</h2>

        <h3>Will my restaurant still appear if I don’t upgrade?</h3>
        <p>Yes — your free listing stays live.</p>

        <h3>How does priority placement work?</h3>
        <p>Upgraded restaurants appear above free listings in search results.</p>

        <h3>How do menus work?</h3>
        <p>
          You upload your menu (PDF, link, or photos) and we format it for the
          app.
        </p>

        <h3>Can I cancel anytime?</h3>
        <p>Yes — your subscription is month‑to‑month.</p>

        <h3>How fast does my listing update?</h3>
        <p>Instantly — changes appear immediately.</p>
      </section>

      <footer>
        <h2>Ready to boost your visibility?</h2>

        <a
          href="/upgrade/checkout"
          style={{
            padding: "12px 20px",
            background: "black",
            color: "white",
            textDecoration: "none",
            borderRadius: "6px",
            display: "inline-block",
            marginTop: "10px"
          }}
        >
          Upgrade for £99/month
        </a>
      </footer>
    </div>
  );
}
