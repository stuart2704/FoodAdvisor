import { Link } from 'wouter';

const product = [
  'Restaurant discovery across cities, regions, countries, and cuisines',
  'AI-assisted descriptions and bounded relevance scoring',
  'Web and Expo mobile experiences',
  'Verified owner portals, menus, booking requests, and analytics',
  'Premium subscription and featured discovery placement',
];

const revenue = [
  '£99 Premium restaurant subscriptions through Stripe',
  'Premium discovery and ranking benefits',
  'Owner analytics and profile-management tools',
];

export default function PitchPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-12 px-6 py-12 md:px-12">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-primary">Investor overview</p>
        <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">
          The Food Advisor
        </h1>
        <p className="mt-5 text-xl leading-8 text-muted-foreground">
          A restaurant discovery platform connecting diners with relevant
          places to eat and giving restaurant owners tools to manage, verify,
          and improve their listings.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-2xl font-semibold">Vision</h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            Make restaurant discovery more useful through structured global
            directory data, transparent ranking signals, personalization, and
            carefully bounded AI assistance.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-2xl font-semibold">Market</h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            Restaurant discovery, local search, bookings, and restaurant
            marketing form a large global category. A formal market-size claim
            should be published only with dated, attributable research.
          </p>
        </div>
      </section>

      <section>
        <h2 className="font-serif text-3xl font-semibold">Product</h2>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {product.map((item) => (
            <li key={item} className="rounded-xl border border-border bg-card p-5">
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-serif text-3xl font-semibold">Revenue model</h2>
        <ul className="mt-5 grid gap-3 md:grid-cols-3">
          {revenue.map((item) => (
            <li key={item} className="rounded-xl border border-border bg-card p-5">
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl bg-foreground p-8 text-background">
        <h2 className="font-serif text-3xl font-semibold">See the product</h2>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/rankings" className="rounded bg-primary px-4 py-2 font-semibold text-primary-foreground">
            View rankings
          </Link>
          <Link href="/pro" className="rounded border border-background/40 px-4 py-2 font-semibold">
            View Premium
          </Link>
          <a href="/food-advisor-project-deck/" className="rounded border border-background/40 px-4 py-2 font-semibold">
            Open project deck
          </a>
        </div>
      </section>
    </main>
  );
}