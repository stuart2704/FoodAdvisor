import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';

export function AdminGate({ children }: { children: ReactNode }) {
  const [, navigate] = useLocation();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/auth/session', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Not authenticated');
        return response.json() as Promise<{ authenticated?: boolean }>;
      })
      .then((result) => {
        if (result.authenticated) setAuthenticated(true);
        else navigate('/admin/login', { replace: true });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          navigate('/admin/login', { replace: true });
        }
      });
    return () => controller.abort();
  }, [navigate]);

  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Checking admin access…
      </div>
    );
  }

  return children;
}