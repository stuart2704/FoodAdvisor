import { Link } from 'wouter';

export default function OwnerClaimPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 md:px-12">
      <h1 className="font-serif text-4xl font-semibold">Claim your restaurant</h1>
      <p className="mt-4 text-muted-foreground">
        Search for your restaurant, open its listing, and choose “Claim this restaurant”
        to begin verification.
      </p>
      <Link href="/search" className="mt-6 inline-block rounded bg-fa-red px-4 py-2 font-semibold text-white">
        Find your restaurant
      </Link>
    </main>
  );
}