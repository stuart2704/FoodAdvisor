export default function SearchBar() {
  return (
    <div className="section">
      <input
        type="text"
        placeholder="Search restaurants, cuisines, cities..."
        style={{
          width: "100%",
          padding: "14px 18px",
          fontSize: "1rem",
          borderRadius: "8px",
          border: "1px solid #ddd",
        }}
      />
    </div>
  );
}