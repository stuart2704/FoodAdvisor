import { Link } from "react-router-dom";
import PublicPage from "../components/PublicPage";

export default function OwnerPage() {
  return (
    <PublicPage
      eyebrow="For restaurant owners"
      title="Claim your restaurant"
      description="Keep your listing accurate and access the tools for restaurant owners. Claims begin with a secure invitation sent to your restaurant's business email."
    >
      <section className="public-page__grid" aria-label="How to claim your restaurant">
        <article className="public-page__card">
          <h2>Have an invitation?</h2>
          <p>
            Open the claim link in the email we sent to your business address.
            That link opens the claim form for your restaurant and verifies which
            listing you can manage. A public listing alone cannot verify ownership.
          </p>
        </article>
        <article className="public-page__card">
          <h2>Find your listing</h2>
          <p>
            Browse the restaurant directory and search by name. If you have not
            received a claim invitation, reply to the team that contacted your
            restaurant to ask for the correct link.
          </p>
          <Link data-testid="link-browse-owner-listings" to="/restaurants">
            Browse restaurant listings
          </Link>
        </article>
      </section>
    </PublicPage>
  );
}