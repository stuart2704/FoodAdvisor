// Inactive draft in this Vite app; does not enable menu uploads or changes.
export default function MenuManager() {
  return (
    <div>
      <h1>Menu Manager</h1>
      <p>Upload or update your menu.</p>

      <a className="upgrade-button" href="/menu-upload">
        Upload Menu
      </a>
    </div>
  );
}