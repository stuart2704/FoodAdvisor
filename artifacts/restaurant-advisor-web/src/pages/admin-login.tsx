import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/admin-login.css';

export default function AdminLogin() {
  const navigate = useNavigate();
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
    <main className="admin-login-page">
      <section className="login-page">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
          <span
            aria-hidden="true"
            style={{
              display: 'grid',
              placeItems: 'center',
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: '#d94800',
              color: '#fff',
              fontWeight: 800,
            }}
          >
            TFA
          </span>
          <div>
            <p style={{ margin: 0, color: '#d94800', fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.14em' }}>
              The Food Advisor
            </p>
            <h1 style={{ margin: '4px 0 0', fontSize: '1.8rem' }}>Admin Login</h1>
          </div>
        </div>

        <form style={{ display: 'grid', gap: '18px' }} onSubmit={handleSubmit}>
          <label style={{ display: 'grid', gap: '8px', fontWeight: 700 }}>
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: '8px', fontWeight: 700 }}>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error ? (
            <p role="alert" style={{ margin: 0, padding: '11px 13px', borderRadius: '10px', background: '#fff0ef', color: '#a12018' }}>
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div
          role="separator"
          aria-label="Alternative sign-in"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            margin: '20px 0',
            color: '#888',
            fontSize: '0.78rem',
          }}
        >
          <span style={{ height: '1px', flex: 1, background: '#333' }} />
          or
          <span style={{ height: '1px', flex: 1, background: '#333' }} />
        </div>

        <button
          type="button"
          onClick={() => navigate('/admin/github')}
          style={{ background: '#24292f' }}
        >
          Continue with GitHub
        </button>
      </section>
    </main>
  );
}