import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, UtensilsCrossed } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function PortalMenuPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [restaurantId, setRestaurantId] = useState('');
  const [items, setItems] = useState<Array<{
    id: number;
    name: string;
    price: string | null;
    description: string | null;
    category: string;
  }>>([]);
  const [form, setForm] = useState({
    name: '',
    price: '',
    description: '',
    category: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/portal/${encodeURIComponent(token)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success?: boolean;
          restaurant?: { placeId: string };
          error?: string;
        };
        if (!response.ok || !payload.success || !payload.restaurant) {
          throw new Error(payload.error ?? 'Owner portal is unavailable.');
        }
        setRestaurantId(payload.restaurant.placeId);
        const menuResponse = await fetch(
          `/api/menus/${encodeURIComponent(payload.restaurant.placeId)}`,
          { signal: controller.signal, cache: 'no-store' },
        );
        const menuPayload = (await menuResponse.json()) as {
          success?: boolean;
          data?: typeof items;
        };
        if (menuResponse.ok && menuPayload.success) setItems(menuPayload.data ?? []);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : 'Menu is unavailable.');
        }
      });
    return () => controller.abort();
  }, [token]);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/portal/${encodeURIComponent(token)}/menu`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          price: form.price.trim() || null,
          description: form.description.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        data?: (typeof items)[number];
        error?: string;
      };
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? 'Menu item could not be added.');
      }
      setItems((current) =>
        [...current, payload.data!].sort((a, b) =>
          `${a.category}:${a.name}`.localeCompare(`${b.category}:${b.name}`),
        ),
      );
      setForm({ name: '', price: '', description: '', category: '' });
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Menu item could not be added.');
    } finally {
      setSaving(false);
    }
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
              <UtensilsCrossed className="h-5 w-5 text-primary" /> Menu
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addItem} className="grid gap-4 sm:grid-cols-2">
              {(['name', 'price', 'category'] as const).map((field) => (
                <label key={field}>
                  <span className="mb-1 block capitalize">{field}</span>
                  <input
                    value={form[field]}
                    required={field !== 'price'}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, [field]: event.target.value }))
                    }
                    className="w-full rounded-md border border-input bg-background p-3"
                  />
                </label>
              ))}
              <label className="sm:col-span-2">
                <span className="mb-1 block">Description</span>
                <textarea
                  value={form.description}
                  maxLength={1000}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                  className="min-h-24 w-full rounded-md border border-input bg-background p-3"
                />
              </label>
              <button
                type="submit"
                disabled={saving || !restaurantId}
                className="rounded bg-fa-red px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {saving ? 'Adding…' : 'Add menu item'}
              </button>
            </form>
            {error && <p className="mt-4 text-destructive" role="alert">{error}</p>}
            <div className="mt-8 space-y-3">
              {items.map((item) => (
                <div key={item.id} className="rounded-lg border p-4">
                  <div className="flex justify-between gap-4">
                    <strong>{item.name}</strong>
                    <span>{item.price}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.category}</p>
                  {item.description && <p className="mt-2 text-sm">{item.description}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}