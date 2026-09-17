import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';

interface PortalRestaurant {
  placeId: string;
  name: string;
  address: string;
  verified: boolean;
}

export default function PortalOnboardingPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [restaurant, setRestaurant] = useState<PortalRestaurant | null>(null);
  const [menuCount, setMenuCount] = useState(0);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/portal/${encodeURIComponent(token)}`, {
      signal: controller.signal,
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success?: boolean;
          restaurant?: PortalRestaurant;
          error?: string;
        };
        if (!response.ok || !payload.success || !payload.restaurant) {
          throw new Error(payload.error ?? 'Owner portal is unavailable.');
        }
        setRestaurant(payload.restaurant);
        const menuResponse = await fetch(
          `/api/menus/${encodeURIComponent(payload.restaurant.placeId)}`,
          { signal: controller.signal, cache: 'no-store' },
        );
        const menuPayload = (await menuResponse.json()) as {
          success?: boolean;
          data?: unknown[];
        };
        if (menuResponse.ok && menuPayload.success) {
          setMenuCount(menuPayload.data?.length ?? 0);
        }
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : 'Onboarding is unavailable.');
        }
      });
    return () => controller.abort();
  }, [token]);

  if (error) {
    return <main className="p-12 text-center text-destructive">{error}</main>;
  }
  if (!restaurant) {
    return <main className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></main>;
  }

  const steps = [
    {
      title: 'Basic information',
      description: `${restaurant.name} · ${restaurant.address}`,
      complete: true,
      href: `/portal/${token}`,
      action: 'Review listing',
    },
    {
      title: 'Menu setup',
      description: menuCount > 0 ? `${menuCount} menu items added.` : 'Add your first menu items.',
      complete: menuCount > 0,
      href: `/portal/${token}/menu`,
      action: 'Manage menu',
    },
    {
      title: 'Photos',
      description: 'Add restaurant photos when secure uploads are enabled.',
      complete: false,
      href: `/portal/${token}/photos`,
      action: 'View photos',
    },
    {
      title: 'Verification',
      description: restaurant.verified
        ? 'Your owner claim is verified.'
        : 'Complete the secure owner claim process.',
      complete: restaurant.verified,
      href: `/portal/${token}`,
      action: 'Review verification',
    },
  ];
  const current = steps[step];

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 md:px-12">
      <Link href={`/portal/${token}`} className="inline-flex items-center gap-2 font-semibold text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to portal
      </Link>
      <h1 className="mt-6 font-serif text-4xl font-semibold">Restaurant onboarding</h1>
      <ol className="mt-8 grid grid-cols-4 gap-2" aria-label="Onboarding progress">
        {steps.map((item, index) => (
          <li key={item.title}>
            <button
              type="button"
              onClick={() => setStep(index)}
              className={`h-2 w-full rounded-full ${index <= step ? 'bg-primary' : 'bg-muted'}`}
              aria-label={`Step ${index + 1}: ${item.title}`}
              aria-current={index === step ? 'step' : undefined}
            />
          </li>
        ))}
      </ol>
      <section className="mt-8 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <h2 className="font-serif text-2xl font-semibold">{current.title}</h2>
          {current.complete && <Check className="h-5 w-5 text-primary" aria-label="Complete" />}
        </div>
        <p className="mt-3 text-muted-foreground">{current.description}</p>
        <Link href={current.href} className="mt-6 inline-block font-semibold text-primary hover:underline">
          {current.action}
        </Link>
      </section>
      <div className="mt-6 flex justify-between">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((currentStep) => Math.max(0, currentStep - 1))}
          className="rounded border border-border px-4 py-2 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={step === steps.length - 1}
          onClick={() =>
            setStep((currentStep) => Math.min(steps.length - 1, currentStep + 1))
          }
          className="rounded bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-40"
        >
          Next step
        </button>
      </div>
    </main>
  );
}