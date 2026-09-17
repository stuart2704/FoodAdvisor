import { Link } from 'wouter';

export default function OwnerManagePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 md:px-12">
      <h1 className="font-serif text-4xl font-semibold">Manage your restaurant</h1>
      <p className="mt-4 text-muted-foreground">
        Verified owners receive a private portal link after claiming their restaurant.
        Use that link to update menu details, photos, and listing information.
      </p>
      <Link href="/support" className="mt-6 inline-block font-semibold text-fa-red underline">
        Contact support if you need a new portal link
      </Link>
    </main>
  );
}