import * as React from "react";

type Props = {
  children: React.ReactNode;
};

export function Layout({ children }: Props) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        color: "#e5e7eb",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
      }}
    >
      <header
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid #1f2937",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "1.2rem" }}>The Food Advisor</div>
        <div style={{ fontSize: "0.9rem", opacity: 0.8 }}>Global restaurant directory</div>
      </header>
      <main style={{ padding: "24px" }}>{children}</main>
    </div>
  );
}