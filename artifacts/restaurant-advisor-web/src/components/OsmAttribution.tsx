export default function OsmAttribution() {
  return (
    <small className="osm-attribution">
      Listing data ©{" "}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
        OpenStreetMap contributors
      </a>{" "}· Open Database Licence (ODbL)
    </small>
  );
}