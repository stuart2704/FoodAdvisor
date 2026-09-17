import { useState } from 'react';
import { useAuth, useClerk } from '@clerk/react';
import { Heart } from 'lucide-react';

export function FavouriteButton({ restaurantId }: { restaurantId: string }) {
  const { isSignedIn } = useAuth();
  const clerk = useClerk();
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!isSignedIn) {
      await clerk.openSignIn();
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/favourites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Favourite could not be saved.');
      }
      setSaved(true);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Favourite could not be saved.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={save}
        disabled={loading || saved}
        className="mt-4 inline-flex items-center gap-2 rounded bg-fa-red px-4 py-2 font-semibold text-white disabled:opacity-60"
      >
        <Heart className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} />
        {saved ? 'Saved to favourites' : loading ? 'Saving…' : 'Save to favourites'}
      </button>
      {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}