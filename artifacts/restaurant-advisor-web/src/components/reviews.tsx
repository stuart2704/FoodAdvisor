import { Show } from '@clerk/react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';

interface Review {
  id: number;
  rating: number;
  review: string;
  createdAt: string;
}

export function Reviews({ restaurantId }: { restaurantId: string }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [rating, setRating] = useState('');
  const [review, setReview] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadReviews = useCallback(async () => {
    const response = await fetch(`/api/reviews/${encodeURIComponent(restaurantId)}`, {
      cache: 'no-store',
    });
    const payload = (await response.json()) as {
      success?: boolean;
      data?: Review[];
      error?: string;
    };
    if (!response.ok || !payload.success) {
      throw new Error(payload.error ?? 'Reviews are unavailable.');
    }
    setReviews(payload.data ?? []);
  }, [restaurantId]);

  useEffect(() => {
    void loadReviews().catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : 'Reviews are unavailable.');
    });
  }, [loadReviews]);

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId,
          rating: Number(rating),
          review,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Review could not be submitted.');
      }
      setRating('');
      setReview('');
      await loadReviews();
    } catch (failure: unknown) {
      setError(
        failure instanceof Error ? failure.message : 'Review could not be submitted.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-border p-6">
      <h2 className="font-serif text-2xl font-bold">Reviews</h2>
      <Show when="signed-in">
        <form onSubmit={submitReview} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block font-medium">Rating</span>
            <input
              type="number"
              min="1"
              max="5"
              required
              value={rating}
              onChange={(event) => setRating(event.target.value)}
              className="w-full rounded border border-input bg-background p-3"
              placeholder="Rating (1–5)"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Your review</span>
            <textarea
              required
              minLength={3}
              maxLength={2000}
              value={review}
              onChange={(event) => setReview(event.target.value)}
              className="min-h-28 w-full rounded border border-input bg-background p-3"
              placeholder="Share your experience"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-fa-red px-4 py-2 font-semibold text-white hover:bg-fa-red/90 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit Review'}
          </button>
        </form>
      </Show>
      <Show when="signed-out">
        <p className="mt-4 text-sm text-muted-foreground">
          <Link href="/sign-in" className="font-semibold text-fa-red underline">
            Sign in
          </Link>{' '}
          to leave a review.
        </p>
      </Show>
      {error && <p className="mt-4 text-destructive" role="alert">{error}</p>}
      <div className="mt-6 space-y-4">
        {reviews.map((item) => (
          <article key={item.id} className="rounded-lg bg-muted/50 p-4">
            <p className="font-medium text-fa-gold">{'★'.repeat(item.rating)}</p>
            <p className="mt-2">{item.review}</p>
            <time className="mt-2 block text-xs text-muted-foreground">
              {new Date(item.createdAt).toLocaleDateString()}
            </time>
          </article>
        ))}
        {reviews.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">No reviews yet.</p>
        )}
      </div>
    </section>
  );
}