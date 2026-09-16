import { useEffect } from 'react';
import { Clock, Mail, UtensilsCrossed } from 'lucide-react';
import { Link } from 'wouter';

export default function Support() {
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;

    document.title = 'Support | The Food Advisor';
    if (description) {
      description.content =
        'Get help with The Food Advisor, including subscriptions, payments, account access, and restaurant information.';
    }

    return () => {
      document.title = previousTitle;
      if (description && previousDescription) {
        description.content = previousDescription;
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 md:px-10">
          <Link href="/" className="flex items-center gap-3" aria-label="The Food Advisor home">
            <span className="rounded-lg bg-primary p-2 text-primary-foreground shadow-sm">
              <UtensilsCrossed className="h-5 w-5" />
            </span>
            <span className="font-serif text-xl font-semibold tracking-tight md:text-2xl">
              The Food Advisor
            </span>
          </Link>
          <Link
            href="/"
            className="text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 md:px-10 md:py-20">
        <section className="mb-12">
          <p className="mb-3 text-sm font-bold uppercase tracking-[0.18em] text-primary">
            Help centre
          </p>
          <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
            The Food Advisor Support
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            If you need help with the app, your subscription, or your account, you’re in the right
            place.
          </p>
        </section>

        <section className="mb-12 rounded-2xl border border-card-border bg-card p-6 shadow-sm md:p-8">
          <h2 className="mb-6 text-3xl font-semibold">Contact us</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <a
              href="mailto:stuart@thefoodadvisor.co.uk"
              className="flex items-start gap-3 rounded-xl bg-muted/60 p-4 transition-colors hover:bg-muted"
            >
              <Mail className="mt-0.5 h-5 w-5 text-primary" />
              <span>
                <span className="block text-sm text-muted-foreground">Email</span>
                <span className="font-semibold">stuart@thefoodadvisor.co.uk</span>
              </span>
            </a>
            <div className="flex items-start gap-3 rounded-xl bg-muted/60 p-4">
              <Clock className="mt-0.5 h-5 w-5 text-primary" />
              <span>
                <span className="block text-sm text-muted-foreground">Hours</span>
                <span className="font-semibold">Monday–Friday, 9am–5pm (UK time)</span>
              </span>
            </div>
          </div>
        </section>

        <section className="mb-14">
          <h2 className="mb-6 text-3xl font-semibold">Frequently asked questions</h2>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-card-border bg-card shadow-sm">
            <article className="p-6 md:p-8">
              <h3 className="text-xl font-semibold">How do I access Premium features?</h3>
              <p className="mt-3 leading-7 text-muted-foreground">
                Premium features unlock automatically once your subscription is active.
              </p>
            </article>
            <article className="p-6 md:p-8">
              <h3 className="text-xl font-semibold">How do I restore my subscription?</h3>
              <ol className="mt-3 list-decimal space-y-2 pl-5 leading-7 text-muted-foreground">
                <li>Open The Food Advisor</li>
                <li>
                  Go to <strong className="text-foreground">Settings</strong>
                </li>
                <li>
                  Tap <strong className="text-foreground">Restore Purchases</strong>
                </li>
              </ol>
            </article>
            <article className="p-6 md:p-8">
              <h3 className="text-xl font-semibold">Payment issues</h3>
              <p className="mt-3 leading-7 text-muted-foreground">
                Check your Apple ID payment method and internet connection.
              </p>
            </article>
            <article className="p-6 md:p-8">
              <h3 className="text-xl font-semibold">Report incorrect restaurant information</h3>
              <p className="mt-3 leading-7 text-muted-foreground">
                Email us with the restaurant name, location, and details.
              </p>
            </article>
          </div>
        </section>

        <section id="privacy-policy" className="scroll-mt-8 border-t border-border py-12">
          <h2 className="text-3xl font-semibold">Privacy Policy</h2>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            <strong>Last updated:</strong> September 2026
          </p>
          <p className="mt-5 leading-7 text-muted-foreground">
            The Food Advisor (“we”, “us”, “our”) operates The Food Advisor mobile application and
            website.
          </p>
        </section>

        <section id="terms-of-service" className="scroll-mt-8 border-t border-border py-12">
          <h2 className="text-3xl font-semibold">Terms of Service</h2>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            <strong>Last updated:</strong> September 2026
          </p>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-6 py-8 text-sm text-muted-foreground md:px-10">
          <span>© 2026 The Food Advisor</span>
          <a href="#privacy-policy" className="hover:text-primary">
            Privacy Policy
          </a>
          <a href="#terms-of-service" className="hover:text-primary">
            Terms of Service
          </a>
        </div>
      </footer>
    </div>
  );
}