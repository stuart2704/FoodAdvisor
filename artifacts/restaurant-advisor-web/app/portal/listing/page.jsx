"use client";

// Inactive draft in this Vite app; does not enable live listing edits.
import { useState, useEffect } from "react";

export default function ListingEditor() {
  const [restaurant, setRestaurant] = useState(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/restaurant");
      const data = await res.json();
      setRestaurant(data);
    };

    load();
  }, []);

  const save = async () => {
    const res = await fetch("/api/listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(restaurant)
    });

    const data = await res.json();
    setStatus(data.message);
  };

  if (!restaurant) return <p>Loading…</p>;

  return (
    <div>
      <h1>Edit Listing</h1>

      <input
        type="text"
        value={restaurant.name}
        onChange={(e) => setRestaurant({ ...restaurant, name: e.target.value })}
      />

      <input
        type="text"
        value={restaurant.address}
        onChange={(e) => setRestaurant({ ...restaurant, address: e.target.value })}
      />

      <textarea
        value={restaurant.description}
        onChange={(e) => setRestaurant({ ...restaurant, description: e.target.value })}
      />

      <button className="upgrade-button" onClick={save}>
        Save Changes
      </button>

      {status && <p>{status}</p>}
    </div>
  );
}