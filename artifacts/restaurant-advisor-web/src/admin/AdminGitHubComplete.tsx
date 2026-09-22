import { useAuth } from "@clerk/react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export default function AdminGitHubComplete() {
  const { isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      navigate("/admin/login", { replace: true });
      return;
    }

    const controller = new AbortController();
    void fetch("/auth/clerk-admin", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          success?: boolean;
          error?: string;
        };
        if (!response.ok || !result.success) {
          throw new Error(result.error ?? "This GitHub account is not authorized.");
        }
        navigate("/admin/dashboard", { replace: true });
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError")) {
          setError(
            failure instanceof Error
              ? failure.message
              : "GitHub administrator sign-in failed.",
          );
        }
      });

    return () => controller.abort();
  }, [isLoaded, isSignedIn, navigate]);

  return (
    <main className="admin-login-page">
      <section className="login-page">
        <h1 style={{ marginTop: 0 }}>GitHub administrator sign-in</h1>
        {error ? (
          <>
            <p role="alert" style={{ color: "#ff9b8d" }}>
              {error}
            </p>
            <Link to="/admin/login" style={{ color: "#ff8b47" }}>
              Return to admin login
            </Link>
          </>
        ) : (
          <p>Verifying administrator access…</p>
        )}
      </section>
    </main>
  );
}