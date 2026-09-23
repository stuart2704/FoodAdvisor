import { Link } from "react-router-dom";
import PublicPage from "../components/PublicPage";

export default function ContactPage() {
  return (
    <PublicPage
      eyebrow="Get in touch"
      title="How can we help?"
      description="Choose the route that best matches your question and we’ll point you in the right direction."
    >
      <section className="public-page__grid" aria-label="Contact options">
        <article className="public-page__card">
          <h2>I’m a diner</h2>
          <p>
            Looking for somewhere to eat? Browse the directory or use the city
            guide to narrow down your next choice.
          </p>
          <Link to="/restaurants">Browse restaurants</Link>
        </article>
        <article className="public-page__card">
          <h2>I run a restaurant</h2>
          <p>
            Use the restaurant area to find your listing, claim it, and manage
            the information diners see.
          </p>
          <Link to="/owner">Go to the restaurant area</Link>
        </article>
      </section>
    </PublicPage>
  );
}