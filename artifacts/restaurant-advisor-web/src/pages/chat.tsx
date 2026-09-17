import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';

interface ChatResult {
  id: string;
  name: string;
  slug: string | null;
  city: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  results?: ChatResult[];
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;
    setMessages((current) => [
      ...current,
      { id: `${Date.now()}-user`, role: 'user', text: message },
    ]);
    setInput('');
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        reply?: string;
        results?: ChatResult[];
        error?: string;
      };
      if (!response.ok || !payload.success || !payload.reply) {
        throw new Error(payload.error ?? 'The restaurant assistant is unavailable.');
      }
      setMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-assistant`,
          role: 'assistant',
          text: payload.reply!,
          results: payload.results,
        },
      ]);
    } catch (failure: unknown) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'The restaurant assistant is unavailable.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl flex-col px-6 py-12 md:px-12">
      <h1 className="font-serif text-4xl font-semibold">Restaurant Assistant</h1>
      <p className="mt-3 text-muted-foreground">
        Ask for restaurants by cuisine or city.
      </p>
      <div className="mt-8 flex-1 space-y-4" aria-live="polite">
        {messages.length === 0 && (
          <p className="rounded-xl border border-border p-5 text-muted-foreground">
            Try “Italian in Cardiff” or “restaurants in London.”
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[90%] rounded-xl p-4 ${
              message.role === 'user'
                ? 'ml-auto bg-primary text-primary-foreground'
                : 'bg-card text-card-foreground border border-border'
            }`}
          >
            <p>{message.text}</p>
            {message.results && message.results.length > 0 && (
              <ul className="mt-3 space-y-2">
                {message.results.map((restaurant) => (
                  <li key={restaurant.id}>
                    <Link
                      href={
                        restaurant.slug
                          ? `/restaurants/${restaurant.slug}`
                          : `/restaurant/${encodeURIComponent(restaurant.id)}`
                      }
                      className="font-semibold underline"
                    >
                      {restaurant.name} · {restaurant.city}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {loading && <p className="text-sm text-muted-foreground">Searching…</p>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </div>
      <form onSubmit={sendMessage} className="mt-8 flex gap-3">
        <input
          required
          maxLength={500}
          className="min-w-0 flex-1 rounded-md border border-input bg-background p-3"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask for a cuisine or city…"
          aria-label="Message"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded bg-fa-red px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </main>
  );
}