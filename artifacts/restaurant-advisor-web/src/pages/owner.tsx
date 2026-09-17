import { Link } from 'wouter';

export default function OwnerDashboard() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12 md:px-12">
      <h1 className="font-serif text-4xl font-semibold">Restaurant Owner Dashboard</h1>
      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Link href="/owner/claim" className="block rounded-lg border p-6 shadow-sm transition hover:bg-muted/50">
          <h2 className="font-serif text-xl font-semibold">Claim Restaurant</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Find your listing and begin verification.
          </p>
        </Link>
        <Link href="/owner/manage" className="block rounded-lg border p-6 shadow-sm transition hover:bg-muted/50">
          <h2 className="font-serif text-xl font-semibold">Manage Restaurant</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Access an existing verified owner portal.
          </p>
        </Link>
      </div>
    </main>
  );
}