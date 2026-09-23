import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <main
      className="text-white"
      style={{
        minHeight: "100vh",
        backgroundColor: "#0d0d0d",
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