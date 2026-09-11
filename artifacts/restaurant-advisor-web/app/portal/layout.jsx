// Inactive draft in this Vite app; portal routes are not configured.
export default function PortalLayout({ children }) {
  return (
    <div className="portal-layout">
      <aside className="portal-sidebar">
        <h2>The Food Advisor</h2>

        <nav>
          <a href="/portal">Dashboard</a>
          <a href="/portal/listing">Listing</a>
          <a href="/portal/menu">Menu</a>
          <a href="/portal/analytics">Analytics</a>
          <a href="/portal/upgrade">Upgrade</a>
        </nav>
      </aside>

      <main className="portal-main">
        {children}
      </main>
    </div>
  );
}