import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, BarChart3, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function PortalAnalyticsPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [valid, setValid] = useState<boolean | null>(null);

  useEffect(() => {
    void fetch(`/api/portal/${encodeURIComponent(token)}`, {
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    }).then((response) => setValid(response.ok)).catch(() => setValid(false));
  }, [token]);

  if (valid === null) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }
  if (!valid) {
    return <div className="flex min-h-screen items-center justify-center p-6">Invalid or expired login link.</div>;
  }
  return (
    <div className="min-h-screen bg-background p-6 text-foreground md:p-12">
      <main className="mx-auto max-w-3xl">
        <Link href={`/portal/${token}`} className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to portal
        </Link>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" /> Analytics</CardTitle></CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Owner analytics are not enabled yet. No visitor or engagement figures are being presented.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}