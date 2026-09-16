import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, BarChart3, Crown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PortalResponse {
  success: boolean;
  restaurant?: { name: string; premium: boolean };
}

export default function PortalAnalyticsPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [portal, setPortal] = useState<PortalResponse | null>(null);

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
              <BarChart3 className="h-5 w-5 text-primary" /> Analytics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!portal.restaurant.premium ? (
              <>
                <p className="text-muted-foreground">
                  Analytics are a Premium feature. Your Basic listing remains active.
                </p>
                <Button asChild>
                  <Link href={`/portal/${token}/upgrade`}>
                    <Crown className="mr-2 h-4 w-4" /> View Premium Options
                  </Link>
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">
                Analytics are included with Premium, but verified reporting data is not available yet.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}