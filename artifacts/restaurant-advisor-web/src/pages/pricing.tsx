import { Link } from 'wouter';

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12 md:px-12">
      <p className="text-sm font-semibold text-primary">For restaurant owners</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">
        Simple listing options
      </h1>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-2xl font-semibold">Basic</h2>
          <p className="mt-3 text-muted-foreground">
            Claim and manage your restaurant’s core listing information.
          </p>
        </section>
        <section className="rounded-xl border-2 border-primary bg-card p-6">
          <h2 className="font-serif text-2xl font-semibold">Premium</h2>
          <p className="mt-2 text-3xl font-semibold">£99 subscription</p>
          <p className="mt-3 text-muted-foreground">
            Premium placement and owner features. Billing terms and the final
            price are shown before payment in Stripe Checkout.
          </p>
          <Link
            href="/owner/claim"
            className="mt-6 inline-block rounded bg-primary px-4 py-2 font-semibold text-primary-foreground"
          >
            Claim your listing
          </Link>
        </section>
      </div>
    </main>
  );
}