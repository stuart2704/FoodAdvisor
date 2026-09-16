import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, Crown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PortalResponse {
  success: boolean;
  restaurant?: { name: string; premium: boolean };
}

export default function PortalUpgradePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [portal, setPortal] = useState<PortalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch(`/api/portal/${encodeURIComponent(token)}`, {
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return (await response.json()) as PortalResponse;
      })
      .then(setPortal)
      .catch(() => setPortal({ success: false }));
  }, [token]);

  async function upgrade() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/premium/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalToken: token }),
      });
      const data = (await response.json()) as {
        success: boolean;
        url?: string;
        error?: string;
      };
      if (!response.ok || !data.url) {
        throw new Error(data.error ?? 'Premium checkout is unavailable.');
      }
      const checkoutUrl = new URL(data.url);
      if (checkoutUrl.protocol !== 'https:' || !checkoutUrl.hostname.endsWith('stripe.com')) {
        throw new Error('The checkout destination was invalid.');
      }
      window.location.assign(checkoutUrl.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Premium checkout is unavailable.');
      setLoading(false);
    }
  }

  if (!portal) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }
  if (!portal.success || !portal.restaurant) {
    return <div className="flex min-h-screen items-center justify-center p-6">Invalid or expired login link.</div>;
  }

  return (
    <div className="min-h-screen bg-background p-6 text-foreground md:p-12">
      <main className="mx-auto max-w-3xl">
        <Link href={`/portal/${token}`} className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to portal
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" /> Upgrade to Premium
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {portal.restaurant.premium ? (
              <p className="font-semibold text-primary">
                {portal.restaurant.name} has an active Premium subscription.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Upgrade your restaurant listing to the configured Premium subscription.
                </p>
                <Button onClick={upgrade} disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {loading ? 'Opening checkout…' : 'Upgrade Now'}
                </Button>
              </>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}