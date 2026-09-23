import { Link } from "react-router-dom";
import PublicPage from "../components/PublicPage";

export default function AboutPage() {
  return (
    <PublicPage
      eyebrow="Our purpose"
      title="Helping good restaurants get discovered"
      description="The Food Advisor connects diners with memorable independent restaurants and gives restaurant teams practical tools to grow."
    >
      <section className="public-page__grid" aria-label="What The Food Advisor offers">
        <article className="public-page__card">
          <h2>For diners</h2>
          <p>
            Find restaurants through curated guides, local recommendations, and
            useful details that make choosing where to eat simpler.
          </p>
          <Link to="/restaurants">Explore restaurants</Link>
        </article>
        <article className="public-page__card">
          <h2>For restaurants</h2>
          <p>
            Claim your listing, keep your information accurate, and understand
            how diners discover your restaurant.
          </p>
          <Link to="/owner">Visit the owner area</Link>
        </article>
      </section>
    </PublicPage>
  );
}