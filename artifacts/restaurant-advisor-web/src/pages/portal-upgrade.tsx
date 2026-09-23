import { useEffect, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Crown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PortalResponse {
  success: boolean;
  restaurant?: { name: string; premium: boolean };
}

export default function PortalUpgradePage() {
  const { token: routeToken = '' } = useParams<{ token: string }>();
  const [returnToken] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('premiumCheckoutReturn') ?? 'null');
      return saved && typeof saved.token === 'string' && saved.expires > Date.now() ? saved.token as string : '';
    } catch { return ''; }
  });
  const token = routeToken || returnToken;
  const location = useLocation();
  const awaitingConfirmation = location.pathname.endsWith('/success');
  const cancelled = location.pathname.endsWith('/cancel');
  const [portal, setPortal] = useState<PortalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    setPortal(null);
    if (!token) {
      setPortal({ success: false });
      return;
    }
    async function refresh() {
      try {
        const response = await fetch(`/api/portal/${encodeURIComponent(token)}`, {
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
        });
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          if (active) setPortal({ success: false });
          return;
        }
        if (!response.ok) throw new Error();
        const data = (await response.json()) as PortalResponse;
        if (!active) return;
        setPortal(data);
        if (awaitingConfirmation && data.success && !data.restaurant?.premium && ++attempts < 30) {
          timer = setTimeout(refresh, 3000);
        }
      } catch {
        if (active) setError('Unable to load subscription status. Please refresh to try again.');
      }
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [token, awaitingConfirmation]);

  async function upgrade() {
    setLoading(true);
    setError('');
    try {
      sessionStorage.setItem('premiumCheckoutReturn', JSON.stringify({
        token, expires: Date.now() + 24 * 60 * 60 * 1000,
      }));
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
      if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
        throw new Error('The checkout destination was invalid.');
      }
      window.location.assign(checkoutUrl.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Premium checkout is unavailable.');
      setLoading(false);
    }
  }

  if (!portal) {
    if (error) return <div role="alert" className="p-6">{error}</div>;
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }
  if (!portal.success || !portal.restaurant) {
    return <div className="flex min-h-screen items-center justify-center p-6">Please reopen your secure owner portal link to check your subscription. Payment status is only shown to the listing owner.</div>;
  }

  return (
    <div className="min-h-screen bg-background p-6 text-foreground md:p-12">
      <main className="mx-auto max-w-3xl">
        <Link to={`/portal/${token}`} className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
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
                  {awaitingConfirmation
                    ? 'Your checkout has returned. We are waiting for Stripe to confirm payment before activating Premium. You can safely return to your portal; please do not pay again.'
                    : 'Upgrade your restaurant listing to Premium for £99 GBP per month.'}
                </p>
                {cancelled && <p>Checkout was cancelled. Your existing listing is unchanged.</p>}
                {!awaitingConfirmation && <Button onClick={upgrade} disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {loading ? 'Opening checkout…' : 'Upgrade Now'}
                </Button>}
              </>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}