// Inactive draft in this Vite app; not a configured route.
// Sample data and asset URLs below are placeholders, not a real listing.
import FeaturedBadge from "@/components/FeaturedBadge";
import "../../../src/styles/upgrade.css";

export default function PremiumPreviewPage() {
  const restaurant = {
    name: "Your Restaurant Name",
    address: "123 Example Street, Cardiff",
    cuisine: "Italian • Pizza • Pasta",
    rating: 4.7,
    reviews: 128,
    photos: [
      "/preview/photo1.jpg",
      "/preview/photo2.jpg",
      "/preview/photo3.jpg"
    ],
    menuLink: "https://yourmenu.com",
    status: "upgraded_preview"
  };

  return (
    <div className="upgrade-container">
      <h1>
        Premium Listing Preview
        <FeaturedBadge />
      </h1>

      <p>Draft preview with sample data only. Paid upgrades are currently unavailable.</p>
      <p>This is how your restaurant will appear once you upgrade.</p>

      <section className="upgrade-section">
        <h2>{restaurant.name}</h2>
        <p>{restaurant.address}</p>
        <p>{restaurant.cuisine}</p>
        <p>⭐ {restaurant.rating} ({restaurant.reviews} reviews)</p>
      </section>

      <section className="upgrade-section">
        <h2>Photos</h2>
        <div className="photo-grid">
          {restaurant.photos.map((src, i) => (
            <img key={i} src={src} alt="Restaurant preview" />
          ))}
        </div>
      </section>

      <section className="upgrade-section">
        <h2>Menu Integration</h2>
        <p>Your menu will be displayed beautifully inside the app.</p>
        <a href={restaurant.menuLink} target="_blank" rel="noopener noreferrer">
          View Menu
        </a>
      </section>

      <section className="upgrade-section">
        <h2>Priority Placement</h2>
        <p>Your listing will appear above free restaurants in search results.</p>
      </section>

      <section className="upgrade-section upgrade-cta">
        <h2>Ready to Upgrade?</h2>
        <button
          type="button"
          className="upgrade-button"
          disabled
          title="Paid upgrades are currently unavailable"
        >
          Upgrade for £99/month
        </button>
      </section>
    </div>
  );
}