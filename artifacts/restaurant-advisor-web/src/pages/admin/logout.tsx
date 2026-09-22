import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function AdminLogout() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/auth/logout", {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Sign out is temporarily unavailable.");
        }
        navigate("/admin/login", { replace: true });
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError")) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Sign out is temporarily unavailable.",
          );
        }
      });
    return () => controller.abort();
  }, [navigate]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#0f0f0f",
        color: error ? "#ff9b8d" : "#eee",
      }}
    >
      <p role={error ? "alert" : undefined}>{error ?? "Signing out…"}</p>
    </main>
  );
}