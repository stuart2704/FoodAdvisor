import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/auth/session", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) =>
        response.json() as Promise<{ authenticated?: boolean }>,
      )
      .then((session) => {
        if (!session.authenticated) {
          navigate("/admin/login", { replace: true });
          return;
        }
        setAuthenticated(true);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          navigate("/admin/login", { replace: true });
        }
      });
    return () => controller.abort();
  }, [navigate]);

  if (!authenticated) {
    return (
      <main
        style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}
      >
        Checking admin access…
      </main>
    );
  }

  return children;
}