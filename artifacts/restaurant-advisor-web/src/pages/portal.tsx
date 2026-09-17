import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { BarChart3, Camera, Crown, ListChecks, Loader2, UtensilsCrossed } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PortalResponse {
  success: boolean;
  restaurant?: {
    placeId: string;
    name: string;
    description: string | null;
    address: string;
    website: string | null;
    onboardingStatus: string | null;
    premium: boolean;
  };
  error?: string;
}

export default function PortalPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalResponse | null>(null);

  useEffect(() => {
    document.title = 'Restaurant Portal | The Food Advisor';
    void fetch(`/api/portal/${encodeURIComponent(token)}`, {
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
      .then(async (response) => {
        const result = (await response.json()) as PortalResponse;
        if (!response.ok) throw new Error(result.error);
        return result;
      })
      .then(setData)
      .catch(() =>
        setData({ success: false, error: 'Invalid or expired login link.' }),
      );
  }, [token]);

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }
  if (!data.success || !data.restaurant) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="max-w-md"><CardContent className="p-8">{data.error}</CardContent></Card>
      </div>
    );
  }
  const restaurant = data.restaurant;
  const sections = [
    { href: `/portal/${token}/onboarding`, label: 'Onboarding Progress', icon: ListChecks },
    { href: `/portal/${token}/menu`, label: 'Manage Menu', icon: UtensilsCrossed },
    { href: `/portal/${token}/photos`, label: 'Manage Photos', icon: Camera },
    {
      href: restaurant.premium
        ? `/portal/${token}/analytics`
        : `/portal/${token}/upgrade`,
      label: restaurant.premium ? 'View Analytics' : 'Analytics — Premium',
      icon: BarChart3,
    },
    { href: `/portal/${token}/upgrade`, label: 'View Premium Options', icon: Crown },
  ];
  return (
    <div className="min-h-screen bg-background p-6 text-foreground md:p-12">
      <main className="mx-auto max-w-5xl space-y-8">
        <div>
          <div className="flex items-center gap-3">
            <p className="text-sm font-semibold text-primary">Restaurant portal</p>
            <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold">
              {restaurant.premium ? 'Premium' : 'Basic'}
            </span>
          </div>
          <h1 className="mt-2 font-serif text-4xl font-semibold">Welcome, {restaurant.name}</h1>
        </div>
        <Card>
          <CardHeader><CardTitle>Your Listing</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p>{restaurant.description ?? 'No public description is available yet.'}</p>
            <p><strong>Address:</strong> {restaurant.address}</p>
            <p><strong>Phone:</strong> Not available in the current listing data.</p>
          </CardContent>
        </Card>
        <div className="grid gap-4 sm:grid-cols-2">
          {sections.map(({ href, label, icon: Icon }) =>
            href ? (
              <Link key={label} href={href} className="rounded-xl border border-border bg-card p-5 font-semibold transition hover:border-primary">
                <Icon className="mb-3 h-5 w-5 text-primary" />{label}
              </Link>
            ) : (
              <div key={label} className="rounded-xl border border-border bg-card p-5 text-muted-foreground">
                <Icon className="mb-3 h-5 w-5" />
                <span className="font-semibold">{label}</span>
                <p className="mt-1 text-xs">Not enabled yet</p>
              </div>
            ),
          )}
        </div>
      </main>
    </div>
  );
}