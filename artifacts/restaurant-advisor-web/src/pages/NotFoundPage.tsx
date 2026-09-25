import { Link } from "react-router-dom";
import PublicPage from "../components/PublicPage";

export default function NotFoundPage() {
  return (
    <PublicPage
      eyebrow="Page not found"
      title="We couldn’t find that page"
      description="The link may be outdated, or the address may have been mistyped. You can head home or find a restaurant instead."
    >
      <nav className="not-found__links" aria-label="Where to go next">
        <Link to="/">Back to Home</Link>
        <Link to="/restaurants">Explore Restaurants</Link>
      </nav>
    </PublicPage>
  );
}