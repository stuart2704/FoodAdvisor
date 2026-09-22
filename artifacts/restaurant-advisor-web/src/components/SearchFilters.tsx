type SearchFiltersProps = {
  search: string;
  setSearch: (value: string) => void;
  city: string;
  setCity: (value: string) => void;
  cuisine: string;
  setCuisine: (value: string) => void;
  rating: string;
  setRating: (value: string) => void;
  openNow: boolean;
  setOpenNow: (value: boolean) => void;
};

export default function SearchFilters({
  search,
  setSearch,
  city,
  setCity,
  cuisine,
  setCuisine,
  rating,
  setRating,
  openNow,
  setOpenNow
}: SearchFiltersProps) {
  return (
    <div
      style={{
        padding: "24px",
        background: "#fff",
        borderRadius: "16px",
        marginBottom: "32px",
        display: "flex",
        flexWrap: "wrap",
        gap: "16px"
      }}
    >
      <input
        type="text"
        placeholder="Search restaurants..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          padding: "12px",
          flex: "1",
          minWidth: "200px",
          borderRadius: "8px",
          border: "1px solid #ccc"
        }}
      />

      <select
        value={city}
        onChange={(e) => setCity(e.target.value)}
        style={{
          padding: "12px",
          borderRadius: "8px",
          border: "1px solid #ccc"
        }}
      >
        <option value="">All Cities</option>
        <option value="Belfast">Belfast</option>
        <option value="Liverpool">Liverpool</option>
        <option value="Manchester">Manchester</option>
        <option value="Glasgow">Glasgow</option>
        <option value="Edinburgh">Edinburgh</option>
        <option value="Cardiff">Cardiff</option>
      </select>

      <select
        value={cuisine}
        onChange={(e) => setCuisine(e.target.value)}
        style={{
          padding: "12px",
          borderRadius: "8px",
          border: "1px solid #ccc"
        }}
      >
        <option value="">All Cuisines</option>
        <option value="italian_restaurant">Italian</option>
        <option value="irish_restaurant">Irish</option>
        <option value="steak_house">Steakhouse</option>
        <option value="european_restaurant">European</option>
        <option value="spanish_restaurant">Spanish</option>
        <option value="bar">Bar</option>
      </select>

      <select
        value={rating}
        onChange={(e) => setRating(e.target.value)}
        style={{
          padding: "12px",
          borderRadius: "8px",
          border: "1px solid #ccc"
        }}
      >
        <option value="">Any Rating</option>
        <option value="4.0">4.0+</option>
        <option value="4.5">4.5+</option>
        <option value="4.7">4.7+</option>
      </select>

      <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          type="checkbox"
          checked={openNow}
          onChange={(e) => setOpenNow(e.target.checked)}
        />
        Open Now
      </label>
    </div>
  );
}