import { NavLink } from "react-router-dom";

const sections = [
  { to: "/admin/dashboard", label: "Dashboard" },
  { to: "/admin/performance", label: "Performance" },
  { to: "/admin/errors", label: "Errors" },
  { to: "/admin/outreach", label: "Outreach" },
  { to: "/admin/restaurants", label: "Restaurants" },
  { to: "/admin/logs", label: "Logs" },
] as const;

export function Sidebar() {
  return (
    <aside
      className="admin-system-navigation"
      style={{
        position: "sticky",
        top: "24px",
        alignSelf: "start",
        padding: "20px 14px",
        border: "1px solid #292929",
        borderRadius: "12px",
        background: "#151515"
      }}
    >
      <div
        style={{
          margin: "0 8px 12px",
          color: "#ff8b47",
          fontSize: "0.78rem",
          fontWeight: 800,
          letterSpacing: "0.14em",
          textTransform: "uppercase"
        }}
      >
        System
      </div>
      <nav aria-label="System administration">
        {sections.map((section) => (
          <NavLink
            key={section.to}
            to={section.to}
            style={({ isActive }) => ({
              display: "block",
              padding: "10px 12px",
              borderRadius: "8px",
              background: isActive ? "#d94800" : "transparent",
              color: isActive ? "#fff" : "#aaa",
              fontWeight: isActive ? 700 : 500,
              textDecoration: "none",
            })}
          >
            {section.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}