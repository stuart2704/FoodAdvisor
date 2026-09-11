// Draft preview only: draft upgrade statuses must not grant live paid benefits.
import FeaturedBadge from "./FeaturedBadge";

export default function DraftSearchResults({ results }) {
  return (
    <>
      {results.map((r) => (
        <div key={r.placeId} className="search-item">
          <span>{r.name}</span>
          {r.status === "upgraded_draft" || r.status === "upgraded" ? (
            <FeaturedBadge />
          ) : null}
        </div>
      ))}
    </>
  );
}