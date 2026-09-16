import { useEffect, useState, type FormEvent } from 'react';
import { LockKeyhole, UtensilsCrossed } from 'lucide-react';
import { useLocation } from 'wouter';

export default function AdminLogin() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Admin Login | The Food Advisor';
    void fetch('/auth/session', {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((response) => response.json() as Promise<{ authenticated?: boolean }>)
      .then((result) => {
        if (result.authenticated) navigate('/admin/dashboard', { replace: true });
      })
      .catch(() => {
        // Keep the login form available if the session check is unavailable.
      });
  }, [navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        setError(result.error ?? 'Login failed.');
        return;
      }
      navigate('/admin/dashboard', { replace: true });
    } catch {
      setError('Could not reach the admin service.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <section className="w-full max-w-md rounded-3xl border border-card-border bg-card p-8 shadow-md md:p-10">
        <div className="mb-8 flex items-center gap-3">
          <span className="rounded-xl bg-primary p-3 text-primary-foreground shadow-sm">
            <UtensilsCrossed className="h-6 w-6" />
          </span>
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
              The Food Advisor
            </p>
            <h1 className="font-serif text-3xl font-semibold">Admin Login</h1>
          </div>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-input bg-background px-4 py-3 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-input bg-background px-4 py-3 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>

          {error ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LockKeyhole className="h-4 w-4" />
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </section>
    </main>
  );
}