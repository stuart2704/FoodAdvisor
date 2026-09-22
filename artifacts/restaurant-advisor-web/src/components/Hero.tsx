export default function Hero() {
  return (
    <div className="hero">
      <img
        src="/logo.png"
        alt="The Food Advisor Logo"
        style={{
          width: "90px",
          height: "90px",
          marginBottom: "20px",
          borderRadius: "20px"
        }}
      />

      <div className="hero-title">The Food Advisor</div>
      <div className="hero-sub">Find a table worth telling people about.</div>
      <div style={{ fontSize: "1rem", opacity: 0.85 }}>
        Discover restaurants near you. Grow your restaurant with AI.
      </div>
    </div>
  );
}