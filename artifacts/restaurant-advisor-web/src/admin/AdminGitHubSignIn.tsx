import { useClerk } from "@clerk/react";
import { useState } from "react";
import { Link } from "react-router-dom";

export default function AdminGitHubSignIn() {
  const clerk = useClerk();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGitHub() {
    setSubmitting(true);
    setError(null);

    try {
      await clerk.client.signIn.authenticateWithRedirect({
        strategy: "oauth_github",
        redirectUrl: "/admin/github/sso-callback",
        redirectUrlComplete: "/admin/github-complete",
      });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "GitHub administrator sign-in could not be started.",
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-login-page">
      <section className="login-page">
        <p
          style={{
            margin: "0 0 8px",
            color: "#d94800",
            fontSize: "0.78rem",
            fontWeight: 800,
            letterSpacing: "0.14em",
          }}
        >
          THE FOOD ADVISOR
        </p>
        <h1 style={{ margin: "0 0 10px", fontSize: "1.8rem" }}>
          GitHub administrator sign-in
        </h1>
        <p style={{ margin: "0 0 24px", color: "#aaa", lineHeight: 1.5 }}>
          Continue with the verified GitHub account linked to the authorized
          administrator email.
        </p>

        {error ? (
          <p
            role="alert"
            style={{
              margin: "0 0 16px",
              padding: "11px 13px",
              borderRadius: "10px",
              background: "#351714",
              color: "#ff9b8d",
            }}
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={submitting}
          onClick={() => void signInWithGitHub()}
          style={{ background: "#24292f" }}
        >
          {submitting ? "Redirecting to GitHub…" : "Continue with GitHub"}
        </button>

        <Link
          to="/admin/login"
          style={{
            display: "block",
            marginTop: "18px",
            color: "#ff8b47",
            textAlign: "center",
          }}
        >
          Use administrator password instead
        </Link>
      </section>
    </main>
  );
}