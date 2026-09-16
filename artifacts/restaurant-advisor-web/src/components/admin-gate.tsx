import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';

async function verifySession(signal: AbortSignal): Promise<boolean> {
  const response = await fetch('/dashboard/stats', {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  const data = (await response.json()) as { success?: boolean };
  if (!data.success) {
    window.location.assign('/admin/login');
    return false;
  }
  return true;
}

export function AdminGate({ children }: { children: ReactNode }) {
  const [, navigate] = useLocation();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void verifySession(controller.signal)
      .then((verified) => {
        if (verified) setAuthenticated(true);
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