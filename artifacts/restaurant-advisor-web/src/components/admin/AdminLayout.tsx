import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0f0f0f",
        color: "#e6e6e6",
        padding: "24px"
      }}
    >
      <div
        className="admin-layout admin-logs-layout"
        style={{
          width: "min(1280px, 100%)",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "180px minmax(0, 1fr)",
          gap: "28px"
        }}
      >
        <Sidebar />
        <section className="admin-content" style={{ minWidth: 0 }}>
          {children}
        </section>
      </div>
    </main>
  );
}